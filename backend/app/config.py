from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

APP_NAME = "Cairn"
EMBEDDING_DIM = 384  # fixed by the DB column; changing it needs a migration + re-embed

AIProvider = Literal["extractive", "anthropic", "openai", "gemini", "ollama", "openai_compatible"]

# Defaults per provider: (fast model for per-link enrichment, smart model for assistant answers)
DEFAULT_MODELS: dict[str, tuple[str, str]] = {
    "anthropic": ("claude-haiku-5-5", "claude-opus-5-5"),
    "openai": ("gpt-5-mini", "gpt-5"),
    "gemini": ("gemini-2.5-flash", "gemini-2.5-pro"),
    "ollama": ("mistral:7b-instruct-v0.3-q5_0", "phi4:latest"),
    "openai_compatible": ("", ""),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")

    database_url: str = "postgresql+psycopg://cairn:cairn@127.0.0.1:5433/cairn"

    allow_registration: bool = True
    cookie_secure: bool = False
    session_ttl_days: int = 30

    storage_dir: Path = Path("./storage")

    allow_private_networks: bool = False
    respect_robots_txt: bool = True
    browser_enabled: bool = True
    worker_concurrency: int = 2
    domain_delay_seconds: float = 1.5
    max_attempts: int = 3
    fetch_timeout_seconds: float = 20.0
    max_page_bytes: int = 5_000_000
    health_check_days: int = 7
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0 Safari/537.36 CairnBot/0.1"
    )

    ai_provider: AIProvider = "extractive"
    ai_model_fast: str = ""
    ai_model_smart: str = ""
    anthropic_api_key: SecretStr | None = None
    openai_api_key: SecretStr | None = None
    gemini_api_key: SecretStr | None = None
    openai_base_url: str | None = None
    ollama_base_url: str = "http://localhost:11434/v1"
    ai_max_input_chars: int = 12_000

    embedding_provider: Literal["fastembed", "hash"] = "fastembed"
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    fastembed_cache_dir: Path = Path("./.models")

    github_token: SecretStr | None = None

    @property
    def models(self) -> tuple[str, str]:
        fast, smart = DEFAULT_MODELS.get(self.ai_provider, ("", ""))
        return self.ai_model_fast or fast, self.ai_model_smart or smart or self.ai_model_fast or fast


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
