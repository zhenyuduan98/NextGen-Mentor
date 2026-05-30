"""Cosmos DB client and database initialization."""
from azure.cosmos import CosmosClient, PartitionKey
from app.config import get_settings

_client = None
_database = None
_containers = {}


def get_cosmos_client():
    global _client
    if _client is None:
        settings = get_settings()
        _client = CosmosClient(settings.cosmos_db_endpoint, settings.cosmos_db_key)
    return _client


def get_database():
    global _database
    if _database is None:
        settings = get_settings()
        client = get_cosmos_client()
        _database = client.create_database_if_not_exists(settings.cosmos_db_database)
    return _database


def get_container(name: str, partition_key: str = "/id"):
    if name not in _containers:
        db = get_database()
        _containers[name] = db.create_container_if_not_exists(
            id=name,
            partition_key=PartitionKey(path=partition_key),
        )
    return _containers[name]


# Convenience accessors
def users_container():
    return get_container("users", "/id")


def sessions_container():
    return get_container("sessions", "/userId")


def documents_container():
    return get_container("documents", "/uploadedBy")


def assessments_container():
    return get_container("assessments", "/userId")
