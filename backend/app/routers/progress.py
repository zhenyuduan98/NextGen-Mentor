"""Progress tracking and dashboard data."""
from fastapi import APIRouter, Depends
from app.routers.auth import get_current_user
from app.database import assessments_container, sessions_container
from app.memory import get_learner_memory

router = APIRouter()


@router.get("/me")
async def get_my_progress(current_user: dict = Depends(get_current_user)):
    """Get personal learning progress dashboard data."""
    user_id = current_user["id"]

    # Get quiz stats
    quiz_container = assessments_container()
    quizzes = list(quiz_container.query_items(
        query="SELECT c.topic, c.difficulty, c.score, c.status, c.createdAt, c.completedAt FROM c WHERE c.userId = @userId",
        parameters=[{"name": "@userId", "value": user_id}],
        partition_key=user_id,
    ))

    completed_quizzes = [q for q in quizzes if q["status"] == "completed"]
    avg_score = round(sum(q["score"] for q in completed_quizzes) / len(completed_quizzes)) if completed_quizzes else 0

    # Get chat stats
    chat_container = sessions_container()
    sessions = list(chat_container.query_items(
        query="SELECT c.id, c.title, c.createdAt, c.updatedAt FROM c WHERE c.userId = @userId",
        parameters=[{"name": "@userId", "value": user_id}],
        partition_key=user_id,
    ))

    # Get memory/skills
    memory = get_learner_memory(user_id)
    skills = memory.get("skills", [])
    context_entries = memory.get("context", [])

    # Topic breakdown from quizzes
    topic_scores = {}
    for q in completed_quizzes:
        topic = q["topic"]
        if topic not in topic_scores:
            topic_scores[topic] = {"scores": [], "count": 0}
        topic_scores[topic]["scores"].append(q["score"])
        topic_scores[topic]["count"] += 1

    topic_breakdown = [
        {
            "topic": topic,
            "avg_score": round(sum(data["scores"]) / len(data["scores"])),
            "attempts": data["count"],
            "best_score": max(data["scores"]),
        }
        for topic, data in topic_scores.items()
    ]

    # Activity timeline (last 7 days)
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    activity = []
    for i in range(7):
        day = now - timedelta(days=i)
        day_str = day.strftime("%Y-%m-%d")
        day_quizzes = [q for q in completed_quizzes if q.get("completedAt", "").startswith(day_str)]
        day_chats = [s for s in sessions if s.get("createdAt", "").startswith(day_str)]
        day_memories = [e for e in context_entries if e.get("timestamp", "").startswith(day_str)]
        activity.append({
            "date": day_str,
            "quizzes": len(day_quizzes),
            "chats": len(day_chats),
            "memories": len(day_memories),
        })

    # Difficulty breakdown
    difficulty_stats = {"beginner": [], "intermediate": [], "advanced": []}
    for q in completed_quizzes:
        diff = q.get("difficulty", "intermediate")
        if diff in difficulty_stats:
            difficulty_stats[diff].append(q["score"])

    difficulty_breakdown = {
        k: {"avg_score": round(sum(v) / len(v)) if v else 0, "count": len(v)}
        for k, v in difficulty_stats.items()
    }

    return {
        "summary": {
            "total_quizzes": len(quizzes),
            "completed_quizzes": len(completed_quizzes),
            "avg_score": avg_score,
            "total_sessions": len(sessions),
            "total_skills": len(skills),
            "total_memories": len(context_entries),
        },
        "skills": skills,
        "topic_breakdown": sorted(topic_breakdown, key=lambda x: x["avg_score"], reverse=True),
        "difficulty_breakdown": difficulty_breakdown,
        "activity": list(reversed(activity)),
        "recent_quizzes": [
            {
                "topic": q["topic"],
                "score": q["score"],
                "difficulty": q["difficulty"],
                "completed_at": q.get("completedAt"),
            }
            for q in sorted(completed_quizzes, key=lambda x: x.get("completedAt", ""), reverse=True)[:5]
        ],
    }
