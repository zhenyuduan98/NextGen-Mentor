"""Memory API routes."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.routers.auth import get_current_user
from app.memory import (
    get_learner_memory,
    add_memory_entry,
    add_skill,
    clear_memory,
)

router = APIRouter()


class MemoryEntry(BaseModel):
    text: str
    category: str = "learning"


class SkillEntry(BaseModel):
    name: str
    level: str = "beginner"
    notes: str = ""


@router.get("")
async def get_memory(current_user: dict = Depends(get_current_user)):
    """Get learner's full memory (context + skills)."""
    memory = get_learner_memory(current_user["id"])
    return {
        "context": memory.get("context", []),
        "skills": memory.get("skills", []),
        "preferences": memory.get("preferences", {}),
        "updatedAt": memory.get("updatedAt"),
    }


@router.post("/entry")
async def add_entry(entry: MemoryEntry, current_user: dict = Depends(get_current_user)):
    """Add a memory entry manually."""
    memory = add_memory_entry(current_user["id"], entry.text, entry.category)
    return {"ok": True, "total_entries": len(memory["context"])}


@router.post("/skill")
async def add_skill_route(skill: SkillEntry, current_user: dict = Depends(get_current_user)):
    """Add or update a skill."""
    memory = add_skill(current_user["id"], skill.name, skill.level, skill.notes)
    return {"ok": True, "total_skills": len(memory["skills"])}


@router.post("/summarize")
async def summarize_to_skills(current_user: dict = Depends(get_current_user)):
    """Use AI to summarize recent context into skills."""
    from anthropic import Anthropic
    from app.config import get_settings
    import json

    settings = get_settings()
    memory = get_learner_memory(current_user["id"])

    if not memory["context"]:
        return {"ok": True, "message": "No context to summarize", "skills": memory["skills"]}

    # Ask Claude to extract skills from context
    context_text = "\n".join(f"- {e['text']}" for e in memory["context"])
    existing_skills = "\n".join(f"- {s['name']}: {s['level']}" for s in memory["skills"]) or "None yet"

    client = Anthropic(base_url=settings.anthropic_base_url, api_key=settings.anthropic_auth_token)
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=1024,
        system="You extract learning skills from context. Return ONLY valid JSON array.",
        messages=[{
            "role": "user",
            "content": f"""Based on this learner's recent activity, extract or update their skills.

Existing skills:
{existing_skills}

Recent learning context:
{context_text}

Return a JSON array of skills, each with: name, level (beginner/intermediate/advanced), notes.
Only include skills that are clearly evidenced. Example:
[{{"name": "Azure App Service", "level": "intermediate", "notes": "Understands deployment and scaling"}}]

Return ONLY the JSON array, no other text."""
        }],
    )

    try:
        skills_data = json.loads(response.content[0].text)
        for skill in skills_data:
            add_skill(
                current_user["id"],
                skill["name"],
                skill.get("level", "beginner"),
                skill.get("notes", ""),
            )
        updated_memory = get_learner_memory(current_user["id"])
        return {"ok": True, "skills": updated_memory["skills"]}
    except (json.JSONDecodeError, KeyError, IndexError):
        return {"ok": False, "message": "Failed to parse AI response", "skills": memory["skills"]}


@router.delete("")
async def delete_memory(current_user: dict = Depends(get_current_user)):
    """Clear all context memory."""
    memory = clear_memory(current_user["id"])
    return {"ok": True}
