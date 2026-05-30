"""Assessment module: auto-generate quizzes from documents and evaluate answers."""
import uuid
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from anthropic import Anthropic
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from app.config import get_settings
from app.routers.auth import get_current_user
from app.database import assessments_container
from app.rag import search_documents

router = APIRouter()


class GenerateQuizRequest(BaseModel):
    topic: str
    num_questions: int = 5
    difficulty: str = "intermediate"  # beginner, intermediate, advanced


class SubmitAnswerRequest(BaseModel):
    quiz_id: str
    answers: dict  # { question_id: selected_option }


class QuizResponse(BaseModel):
    id: str
    topic: str
    difficulty: str
    questions: list
    created_at: str
    status: str


@router.post("/generate")
async def generate_quiz(req: GenerateQuizRequest, current_user: dict = Depends(get_current_user)):
    """Generate a quiz from training materials on a given topic."""
    settings = get_settings()

    # Search for relevant content
    results = search_documents(req.topic, top_k=5)
    context = "\n\n".join(r["content"] for r in results) if results else ""

    if not context:
        context = f"General knowledge about {req.topic} in Azure cloud computing."

    # Ask Claude to generate quiz
    client = Anthropic(base_url=settings.anthropic_base_url, api_key=settings.anthropic_auth_token)
    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=2048,
        system="You are a quiz generator for Azure cloud training. Generate clear, educational questions. Return ONLY valid JSON.",
        messages=[{
            "role": "user",
            "content": f"""Generate a quiz with {req.num_questions} questions about "{req.topic}".
Difficulty: {req.difficulty}

IMPORTANT: Mix question types!
- About 60% should be multiple-choice (type: "mcq")
- About 40% should be short-answer/open-ended (type: "open")

Base the questions on this training material:
{context[:3000]}

Return ONLY a JSON array. Each question must have:
- id: "q1", "q2", etc.
- type: "mcq" or "open"
- question: the question text

For MCQ questions, also include:
- options: array of 4 options ["A. ...", "B. ...", "C. ...", "D. ..."]
- correct: the correct option letter ("A", "B", "C", or "D")
- explanation: brief explanation

For OPEN questions, also include:
- key_points: array of 2-4 key points that a good answer should cover
- sample_answer: a model answer (1-3 sentences)
- explanation: what makes a good answer

Example:
[{{"id":"q1","type":"mcq","question":"What is Azure App Service?","options":["A. A database service","B. A platform for hosting web apps","C. A virtual machine","D. A storage solution"],"correct":"B","explanation":"Azure App Service is a fully managed platform for building and hosting web applications."}},
{{"id":"q2","type":"open","question":"Explain how Azure App Service handles scaling.","key_points":["Supports both vertical and horizontal scaling","Auto-scale based on metrics or schedule","Scale out adds more instances"],"sample_answer":"Azure App Service supports both vertical scaling (scaling up to larger VMs) and horizontal scaling (scaling out to multiple instances). Auto-scale can be configured based on metrics like CPU usage or on a schedule.","explanation":"A good answer covers both scaling directions and mentions auto-scale."}}]

Return ONLY the JSON array."""
        }],
    )

    try:
        questions = json.loads(response.content[0].text)
    except json.JSONDecodeError:
        # Try to extract JSON from the response
        import re
        match = re.search(r'\[.*\]', response.content[0].text, re.DOTALL)
        if match:
            questions = json.loads(match.group())
        else:
            raise HTTPException(status_code=500, detail="Failed to generate quiz")

    # Save quiz to Cosmos DB
    quiz_id = str(uuid.uuid4())
    quiz = {
        "id": quiz_id,
        "userId": current_user["id"],
        "topic": req.topic,
        "difficulty": req.difficulty,
        "questions": questions,
        "answers": {},
        "score": None,
        "status": "pending",  # pending, completed
        "createdAt": datetime.utcnow().isoformat(),
        "completedAt": None,
    }

    container = assessments_container()
    container.create_item(body=quiz)

    return {
        "id": quiz_id,
        "topic": req.topic,
        "difficulty": req.difficulty,
        "questions": [
            {
                "id": q["id"],
                "type": q.get("type", "mcq"),
                "question": q["question"],
                "options": q.get("options", []),
            }
            for q in questions
        ],
        "created_at": quiz["createdAt"],
        "status": "pending",
    }


@router.post("/submit")
async def submit_quiz(req: SubmitAnswerRequest, current_user: dict = Depends(get_current_user)):
    """Submit quiz answers and get results."""
    settings = get_settings()
    container = assessments_container()

    try:
        quiz = container.read_item(item=req.quiz_id, partition_key=current_user["id"])
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Quiz not found")

    if quiz["status"] == "completed":
        raise HTTPException(status_code=400, detail="Quiz already completed")

    # Grade the quiz
    correct_count = 0
    total_points = 0
    earned_points = 0
    results = []

    # Collect open questions for batch AI grading
    open_questions = []
    for q in quiz["questions"]:
        q_type = q.get("type", "mcq")
        user_answer = req.answers.get(q["id"], "")

        if q_type == "mcq":
            is_correct = user_answer.upper() == q["correct"].upper() if user_answer else False
            if is_correct:
                correct_count += 1
                earned_points += 1
            total_points += 1
            results.append({
                "id": q["id"],
                "type": "mcq",
                "question": q["question"],
                "user_answer": user_answer,
                "correct_answer": q["correct"],
                "is_correct": is_correct,
                "explanation": q.get("explanation", ""),
            })
        else:  # open question
            open_questions.append({
                "id": q["id"],
                "question": q["question"],
                "user_answer": user_answer,
                "key_points": q.get("key_points", []),
                "sample_answer": q.get("sample_answer", ""),
            })
            total_points += 1

    # AI grade open questions
    if open_questions:
        client = Anthropic(base_url=settings.anthropic_base_url, api_key=settings.anthropic_auth_token)
        grading_prompt = "Grade these open-ended answers. Return ONLY a JSON array.\n\n"
        for oq in open_questions:
            grading_prompt += f"""Question: {oq['question']}
Key points expected: {', '.join(oq['key_points'])}
Sample answer: {oq['sample_answer']}
Student's answer: {oq['user_answer'] or '(no answer)'}
---
"""
        grading_prompt += """\nFor each question return:
- id: the question id
- score: 0-100 (0=wrong/empty, 50=partial, 100=fully correct)
- feedback: specific constructive feedback (1-2 sentences)
- is_correct: true if score >= 70

Return ONLY a JSON array like: [{"id":"q2","score":80,"feedback":"Good explanation but missed mentioning auto-scale.","is_correct":true}]"""

        response = client.messages.create(
            model=settings.anthropic_model,
            max_tokens=1024,
            system="You are a fair and encouraging grader. Grade based on key points coverage. Be constructive.",
            messages=[{"role": "user", "content": grading_prompt}],
        )

        try:
            import re
            text = response.content[0].text
            match = re.search(r'\[.*\]', text, re.DOTALL)
            grades = json.loads(match.group()) if match else []
        except (json.JSONDecodeError, AttributeError):
            grades = []

        # Map grades back
        grade_map = {g["id"]: g for g in grades}
        for oq in open_questions:
            grade = grade_map.get(oq["id"], {"score": 0, "feedback": "Could not grade.", "is_correct": False})
            is_correct = grade.get("is_correct", grade.get("score", 0) >= 70)
            if is_correct:
                correct_count += 1
                earned_points += 1
            results.append({
                "id": oq["id"],
                "type": "open",
                "question": oq["question"],
                "user_answer": oq["user_answer"],
                "score": grade.get("score", 0),
                "feedback": grade.get("feedback", ""),
                "is_correct": is_correct,
                "sample_answer": oq["sample_answer"],
                "key_points": oq["key_points"],
            })

    score = round((earned_points / total_points) * 100) if total_points > 0 else 0

    # Update quiz in DB
    quiz["answers"] = req.answers
    quiz["score"] = score
    quiz["status"] = "completed"
    quiz["completedAt"] = datetime.utcnow().isoformat()
    quiz["results"] = results
    container.upsert_item(body=quiz)

    # Add to learner memory
    from app.memory import add_memory_entry
    add_memory_entry(
        current_user["id"],
        f"Completed quiz on '{quiz['topic']}' ({quiz['difficulty']}): scored {score}%",
        category="assessment",
    )

    return {
        "quiz_id": req.quiz_id,
        "score": score,
        "correct": correct_count,
        "total": total_points,
        "results": results,
    }


@router.get("/quizzes")
async def list_quizzes(current_user: dict = Depends(get_current_user)):
    """List all quizzes for current user."""
    container = assessments_container()
    query = "SELECT c.id, c.topic, c.difficulty, c.score, c.status, c.createdAt, c.completedAt FROM c WHERE c.userId = @userId ORDER BY c.createdAt DESC"
    params = [{"name": "@userId", "value": current_user["id"]}]
    results = list(container.query_items(query=query, parameters=params, partition_key=current_user["id"]))
    return results


@router.get("/quizzes/{quiz_id}")
async def get_quiz(quiz_id: str, current_user: dict = Depends(get_current_user)):
    """Get a specific quiz with results."""
    container = assessments_container()
    try:
        quiz = container.read_item(item=quiz_id, partition_key=current_user["id"])
        if quiz["status"] == "pending":
            # Don't expose answers for pending quiz
            return {
                "id": quiz["id"],
                "topic": quiz["topic"],
                "difficulty": quiz["difficulty"],
                "questions": [{"id": q["id"], "question": q["question"], "options": q["options"]} for q in quiz["questions"]],
                "status": "pending",
                "created_at": quiz["createdAt"],
            }
        return quiz
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Quiz not found")
