from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # LLM
    anthropic_base_url: str = ""
    anthropic_auth_token: str = ""
    anthropic_model: str = "claude-opus-4.6"

    # Azure AI Search
    azure_search_endpoint: str = ""
    azure_search_key: str = ""
    azure_search_index: str = "nextgen-mentor-docs"

    # Cosmos DB
    cosmos_db_endpoint: str = ""
    cosmos_db_key: str = ""
    cosmos_db_database: str = "nextgen-mentor"

    # Azure AI Search
    azure_search_index: str = "nextgen-mentor-docs"

    # Auth
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    class Config:
        env_file = ".env"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
