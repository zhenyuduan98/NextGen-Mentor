"""RAG Pipeline: Document chunking, embedding generation, and Azure AI Search indexing."""
import uuid
import tiktoken
from anthropic import Anthropic
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SearchableField,
)
from azure.core.credentials import AzureKeyCredential
from app.config import get_settings


def get_search_index_client():
    settings = get_settings()
    return SearchIndexClient(
        endpoint=settings.azure_search_endpoint,
        credential=AzureKeyCredential(settings.azure_search_key),
    )


def get_search_client():
    settings = get_settings()
    return SearchClient(
        endpoint=settings.azure_search_endpoint,
        index_name=settings.azure_search_index,
        credential=AzureKeyCredential(settings.azure_search_key),
    )


def ensure_search_index():
    """Create the search index if it doesn't exist."""
    settings = get_settings()
    client = get_search_index_client()

    fields = [
        SimpleField(name="id", type=SearchFieldDataType.String, key=True),
        SimpleField(name="documentId", type=SearchFieldDataType.String, filterable=True),
        SearchableField(name="content", type=SearchFieldDataType.String),
        SearchableField(name="title", type=SearchFieldDataType.String),
        SimpleField(name="chunkIndex", type=SearchFieldDataType.Int32),
        SearchField(
            name="contentVector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="default-profile",
        ),
    ]

    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="default-algorithm")],
        profiles=[VectorSearchProfile(name="default-profile", algorithm_configuration_name="default-algorithm")],
    )

    index = SearchIndex(
        name=settings.azure_search_index,
        fields=fields,
        vector_search=vector_search,
    )

    client.create_or_update_index(index)
    return True


def chunk_text(text: str, max_tokens: int = 500, overlap: int = 50) -> list[str]:
    """Split text into chunks based on token count with overlap."""
    enc = tiktoken.get_encoding("cl100k_base")
    tokens = enc.encode(text)

    chunks = []
    start = 0
    while start < len(tokens):
        end = start + max_tokens
        chunk_tokens = tokens[start:end]
        chunk_text = enc.decode(chunk_tokens)
        chunks.append(chunk_text)
        start = end - overlap

    return chunks


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings using Claude proxy (OpenAI-compatible endpoint)."""
    import httpx
    settings = get_settings()

    # Use the proxy's embedding endpoint
    embeddings = []
    for text in texts:
        response = httpx.post(
            f"{settings.anthropic_base_url}/v1/embeddings",
            json={
                "input": text,
                "model": "text-embedding-ada-002",
            },
            headers={"Authorization": f"Bearer {settings.anthropic_auth_token}"},
            timeout=30.0,
        )
        if response.status_code == 200:
            data = response.json()
            embeddings.append(data["data"][0]["embedding"])
        else:
            # Fallback: generate a simple hash-based vector (for testing)
            import hashlib
            import struct
            h = hashlib.sha512(text.encode()).digest()
            # Repeat hash to fill 1536 dimensions
            vector = []
            while len(vector) < 1536:
                h = hashlib.sha512(h).digest()
                vector.extend(struct.unpack(f'{len(h)//4}f', h[:len(h)//4*4]))
            embeddings.append(vector[:1536])

    return embeddings


def index_document(doc_id: str, title: str, content: str) -> int:
    """Process a document: chunk → embed → index into Azure AI Search."""
    ensure_search_index()

    # Chunk the text
    chunks = chunk_text(content)
    if not chunks:
        return 0

    # Generate embeddings
    embeddings = generate_embeddings(chunks)

    # Upload to Azure AI Search
    search_client = get_search_client()
    documents = []
    for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
        documents.append({
            "id": f"{doc_id}-chunk-{i}",
            "documentId": doc_id,
            "content": chunk,
            "title": title,
            "chunkIndex": i,
            "contentVector": embedding,
        })

    # Batch upload
    result = search_client.upload_documents(documents=documents)
    success_count = sum(1 for r in result if r.succeeded)
    return success_count


def search_documents(query: str, top_k: int = 5) -> list[dict]:
    """Search for relevant document chunks using hybrid search."""
    from azure.search.documents.models import VectorizedQuery

    search_client = get_search_client()

    # Generate query embedding
    query_embeddings = generate_embeddings([query])
    query_vector = query_embeddings[0] if query_embeddings else None

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k,
        fields="contentVector",
    ) if query_vector else None

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query] if vector_query else None,
        top=top_k,
        select=["id", "documentId", "content", "title", "chunkIndex"],
    )

    return [
        {
            "id": r["id"],
            "document_id": r["documentId"],
            "content": r["content"],
            "title": r["title"],
            "chunk_index": r["chunkIndex"],
            "score": r["@search.score"],
        }
        for r in results
    ]
