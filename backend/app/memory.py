"""Learner Memory: persistent context memory and skills extraction."""
import uuid
from datetime import datetime
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from app.database import get_container


def memory_container():
    return get_container("learner-memory", "/userId")


def get_learner_memory(user_id: str) -> dict:
    """Get or create a learner's memory document."""
    container = memory_container()
    try:
        results = list(container.query_items(
            query="SELECT * FROM c WHERE c.userId = @userId",
            parameters=[{"name": "@userId", "value": user_id}],
            partition_key=user_id,
        ))
        if results:
            return results[0]
    except Exception:
        pass

    # Create new memory doc
    memory = {
        "id": str(uuid.uuid4()),
        "userId": user_id,
        "context": [],  # List of memory entries
        "skills": [],   # Summarized skills
        "preferences": {},  # Learning preferences
        "createdAt": datetime.utcnow().isoformat(),
        "updatedAt": datetime.utcnow().isoformat(),
    }
    container.create_item(body=memory)
    return memory


def add_memory_entry(user_id: str, entry: str, category: str = "learning") -> dict:
    """Add a memory entry for a learner."""
    memory = get_learner_memory(user_id)
    container = memory_container()

    memory["context"].append({
        "id": str(uuid.uuid4()),
        "text": entry,
        "category": category,
        "timestamp": datetime.utcnow().isoformat(),
    })
    # Keep last 50 entries
    if len(memory["context"]) > 50:
        memory["context"] = memory["context"][-50:]

    memory["updatedAt"] = datetime.utcnow().isoformat()
    container.upsert_item(body=memory)
    return memory


def add_skill(user_id: str, skill_name: str, level: str = "beginner", notes: str = "") -> dict:
    """Add or update a skill for a learner."""
    memory = get_learner_memory(user_id)
    container = memory_container()

    # Check if skill exists
    existing = next((s for s in memory["skills"] if s["name"].lower() == skill_name.lower()), None)
    if existing:
        existing["level"] = level
        existing["notes"] = notes
        existing["updatedAt"] = datetime.utcnow().isoformat()
    else:
        memory["skills"].append({
            "id": str(uuid.uuid4()),
            "name": skill_name,
            "level": level,  # beginner, intermediate, advanced
            "notes": notes,
            "createdAt": datetime.utcnow().isoformat(),
            "updatedAt": datetime.utcnow().isoformat(),
        })

    memory["updatedAt"] = datetime.utcnow().isoformat()
    container.upsert_item(body=memory)
    return memory


def get_memory_context_for_prompt(user_id: str) -> str:
    """Generate a context string from learner memory for the system prompt."""
    memory = get_learner_memory(user_id)

    parts = []

    # Skills summary
    if memory["skills"]:
        parts.append("## Learner's Current Skills:")
        for s in memory["skills"]:
            parts.append(f"- {s['name']}: {s['level']}" + (f" ({s['notes']})" if s.get('notes') else ""))

    # Recent context/memories
    if memory["context"]:
        parts.append("\n## Recent Learning Context:")
        for entry in memory["context"][-10:]:  # Last 10 entries
            parts.append(f"- [{entry['category']}] {entry['text']}")

    # Preferences
    if memory.get("preferences"):
        parts.append("\n## Learner Preferences:")
        for k, v in memory["preferences"].items():
            parts.append(f"- {k}: {v}")

    return "\n".join(parts) if parts else ""


def clear_memory(user_id: str) -> dict:
    """Clear all memory for a learner."""
    memory = get_learner_memory(user_id)
    container = memory_container()
    memory["context"] = []
    memory["updatedAt"] = datetime.utcnow().isoformat()
    container.upsert_item(body=memory)
    return memory
