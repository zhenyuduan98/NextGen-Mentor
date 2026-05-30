from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import auth, chat, documents, memory, assessment, progress

app = FastAPI(
    title="NextGen Mentor API",
    description="AI-powered virtual mentor backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(chat.router, prefix="/api/chat", tags=["Chat"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(memory.router, prefix="/api/memory", tags=["Memory"])
app.include_router(assessment.router, prefix="/api/assessment", tags=["Assessment"])
app.include_router(progress.router, prefix="/api/progress", tags=["Progress"])


@app.get("/health")
async def health():
    return {"status": "ok", "service": "nextgen-mentor"}
