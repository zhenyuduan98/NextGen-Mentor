import uuid
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from app.routers.auth import get_current_user
from app.database import documents_container
from azure.cosmos.exceptions import CosmosResourceNotFoundError

router = APIRouter()


class DocumentResponse(BaseModel):
    id: str
    filename: str
    content_type: str
    chunk_count: int
    status: str
    created_at: str


def process_document(doc_id: str, filename: str, content: str):
    """Background task: chunk + embed + index document."""
    from app.rag import index_document
    container = documents_container()

    try:
        chunk_count = index_document(doc_id, filename, content)
        # Update status in Cosmos DB
        try:
            doc = container.read_item(item=doc_id, partition_key=doc_id)
            doc["chunkCount"] = chunk_count
            doc["status"] = "indexed"
            container.upsert_item(body=doc)
        except Exception:
            pass
    except Exception as e:
        try:
            doc = container.read_item(item=doc_id, partition_key=doc_id)
            doc["status"] = "failed"
            doc["error"] = str(e)
            container.upsert_item(body=doc)
        except Exception:
            pass


@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    """Upload a document for RAG indexing."""
    if current_user["role"] not in ("admin", "mentor", "learner"):
        raise HTTPException(status_code=403, detail="Permission denied")

    content_bytes = await file.read()

    # Extract text based on file type
    filename = file.filename or "untitled"
    content_type = file.content_type or "text/plain"

    if filename.endswith(".pdf"):
        from pypdf import PdfReader
        import io
        reader = PdfReader(io.BytesIO(content_bytes))
        text = "\n\n".join(page.extract_text() or "" for page in reader.pages)
    else:
        text = content_bytes.decode("utf-8", errors="ignore")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Document is empty or unreadable")

    doc_id = str(uuid.uuid4())
    doc = {
        "id": doc_id,
        "filename": filename,
        "contentType": content_type,
        "uploadedBy": current_user["id"],
        "chunkCount": 0,
        "status": "processing",
        "createdAt": datetime.utcnow().isoformat(),
    }

    container = documents_container()
    container.create_item(body=doc)

    # Process in background
    background_tasks.add_task(process_document, doc_id, filename, text)

    return DocumentResponse(
        id=doc_id,
        filename=filename,
        content_type=content_type,
        chunk_count=0,
        status="processing",
        created_at=doc["createdAt"],
    )


@router.get("", response_model=list[DocumentResponse])
async def list_documents(current_user: dict = Depends(get_current_user)):
    """List all documents."""
    container = documents_container()
    query = "SELECT * FROM c"
    results = list(container.query_items(query=query, enable_cross_partition_query=True))
    return [
        DocumentResponse(
            id=d["id"],
            filename=d["filename"],
            content_type=d["contentType"],
            chunk_count=d.get("chunkCount", 0),
            status=d["status"],
            created_at=d["createdAt"],
        )
        for d in results
    ]


@router.delete("/{doc_id}")
async def delete_document(doc_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a document and its search index entries."""
    container = documents_container()
    try:
        container.read_item(item=doc_id, partition_key=doc_id)
    except CosmosResourceNotFoundError:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete from search index
    try:
        from app.rag import get_search_client
        search_client = get_search_client()
        # Find all chunks for this document
        results = search_client.search(
            search_text="*",
            filter=f"documentId eq '{doc_id}'",
            select=["id"],
        )
        ids_to_delete = [{"id": r["id"]} for r in results]
        if ids_to_delete:
            search_client.delete_documents(documents=ids_to_delete)
    except Exception:
        pass

    # Delete from Cosmos DB
    container.delete_item(item=doc_id, partition_key=doc_id)
    return {"ok": True}
