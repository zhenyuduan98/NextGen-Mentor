import uuid
from datetime import datetime
from typing import AsyncGenerator
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from anthropic import AsyncAnthropic
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from app.config import get_settings
from app.routers.auth import get_current_user
from app.database import sessions_container

router = APIRouter()


class ChatMessage(BaseModel):
    message: str
    session_id: str | None = None


class SessionResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


def get_llm_client() -> AsyncAnthropic:
    settings = get_settings()
    return AsyncAnthropic(
        base_url=settings.anthropic_base_url,
        api_key=settings.anthropic_auth_token,
    )


def retrieve_context(query: str) -> tuple[str, list[dict]]:
    """Retrieve relevant context from Azure AI Search."""
    try:
        from app.rag import search_documents
        results = search_documents(query, top_k=3)
        if not results:
            return "", []

        context_parts = []
        sources = []
        for r in results:
            context_parts.append(f"[Source: {r['title']}]\n{r['content']}")
            sources.append({
                "title": r['title'],
                "content": r['content'],
                "chunk_index": r['chunk_index'],
                "score": r.get('score', 0),
            })

        return "\n\n---\n\n".join(context_parts), sources
    except Exception:
        return "", []


@router.post("")
async def send_message(
    req: ChatMessage,
    current_user: dict = Depends(get_current_user),
):
    """Send a message and get streaming AI response with RAG."""
    settings = get_settings()
    user_id = current_user["id"]
    container = sessions_container()

    # Get or create session
    session_id = req.session_id or str(uuid.uuid4())
    try:
        session = container.read_item(item=session_id, partition_key=user_id)
    except CosmosResourceNotFoundError:
        session = {
            "id": session_id,
            "userId": user_id,
            "title": req.message[:50],
            "messages": [],
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        }

    # Add user message
    session["messages"].append({
        "role": "user",
        "content": req.message,
        "timestamp": datetime.utcnow().isoformat(),
    })
    session["updatedAt"] = datetime.utcnow().isoformat()

    # RAG: Retrieve relevant context
    rag_context, sources = retrieve_context(req.message)

    # Memory: Get learner's persistent context
    from app.memory import get_memory_context_for_prompt, add_memory_entry
    learner_context = get_memory_context_for_prompt(user_id)

    # Build system prompt with RAG context
    system_prompt = """You are NextGen Mentor, a warm and gentle Azure trainer who guides 
learners step by step through their Azure learning journey. 

Your personality:
- You are patient, encouraging, and supportive — like a kind mentor who truly cares about the learner's growth
- You celebrate small wins and progress ("Great question! That shows you're thinking deeply about this.")
- You break down complex Azure concepts into digestible pieces
- You use analogies and real-world examples to make things click
- You never make the learner feel stupid for asking basic questions
- You gently guide them to the next learning step when they're ready
- You check understanding before moving on ("Does that make sense? Would you like me to explain further?")

Your approach:
1. When a learner asks a question, first acknowledge it warmly
2. Explain the concept clearly, starting from fundamentals if needed
3. Provide practical examples or scenarios
4. Reference the training materials when available (cite sources)
5. Suggest what to explore next in their learning path
6. Keep a supportive, conversational tone throughout

Reply in the same language as the user's message. If they write in Chinese, reply in Chinese.
Always be gentle, never condescending. You're their learning companion, not a lecturer.
You may use markdown formatting (headings, bold, lists, code blocks) to make your answers clear and well-structured."""

    if rag_context:
        system_prompt += f"""

## Retrieved Training Materials:
{rag_context}

## Instructions:
- Use the above materials to answer the user's question when relevant
- Cite sources using [Source: document name] format
- If the materials don't contain relevant info, answer from your general knowledge but mention that
"""

    if learner_context:
        system_prompt += f"""

## Learner Profile (Memory):
{learner_context}

Use this context to personalize your response. Reference their existing skills and build upon them.
"""

    # Auto-add learning context after each interaction
    system_prompt += """

## Memory Instructions:
At the END of your response, if the learner demonstrated understanding of a new concept or 
asked a meaningful question about a topic, add a line starting with [MEMORY] followed by a 
brief note about what they learned or are working on. Example:
[MEMORY] Learned about Azure App Service deployment slots
[MEMORY] Working on understanding Cosmos DB partition keys
Only add [MEMORY] lines if there's something genuinely worth remembering. Maximum 2 per response.
"""

    # Build messages (last 20 messages for context window)
    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in session["messages"][-20:]
    ]

    async def generate() -> AsyncGenerator[str, None]:
        client = get_llm_client()
        full_response = ""

        async with client.messages.stream(
            model=settings.anthropic_model,
            max_tokens=2048,
            system=system_prompt,
            messages=messages,
        ) as stream:
            async for text in stream.text_stream:
                full_response += text
                yield f"data: {text}\n\n"

        # Save assistant response to session
        # Extract and save memory entries
        import re
        memory_entries = re.findall(r'\[MEMORY\]\s*(.+)', full_response)
        for entry in memory_entries:
            add_memory_entry(user_id, entry.strip())

        # Remove [MEMORY] lines from the displayed response
        clean_response = re.sub(r'\n?\[MEMORY\].*', '', full_response).strip()

        session["messages"].append({
            "role": "assistant",
            "content": clean_response,
            "sources": sources,
            "timestamp": datetime.utcnow().isoformat(),
        })
        container.upsert_item(body=session)

        # Send sources as a special event
        import json
        if sources:
            yield f"data: [SOURCES]{json.dumps(sources)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "X-Session-Id": session_id,
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
            "Content-Type": "text/event-stream; charset=utf-8",
        },
    )


@router.get("/sessions")
async def list_sessions(current_user: dict = Depends(get_current_user)):
    """List all chat sessions for current user."""
    user_id = current_user["id"]
    container = sessions_container()
    query = "SELECT c.id, c.title, c.createdAt, c.updatedAt FROM c WHERE c.userId = @userId ORDER BY c.updatedAt DESC"
    params = [{"name": "@userId", "value": user_id}]
    results = list(container.query_items(query=query, parameters=params, partition_key=user_id))
    return [
        SessionResponse(
            id=r["id"],
            title=r["title"],
            created_at=r["createdAt"],
            updated_at=r["updatedAt"],
        )
        for r in results
    ]


@router.get("/sessions/{session_id}")
async def get_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Get messages for a specific session."""
    container = sessions_container()
    try:
        session = container.read_item(item=session_id, partition_key=current_user["id"])
        return session
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a chat session."""
    container = sessions_container()
    try:
        container.delete_item(item=session_id, partition_key=current_user["id"])
        return {"ok": True}
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Session not found")
