"""Provider-neutral LLM interface. Core logic only talks to `LLMProvider`; adapters live in sibling modules.

- anthropic_provider: Anthropic Claude (official SDK, structured outputs)
- openai_provider:    any OpenAI-compatible Chat Completions API (OpenAI, Gemini, Ollama, vLLM, ...)
"""

from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol, TypeVar

from pydantic import BaseModel

from app.config import settings

T = TypeVar("T", bound=BaseModel)


class LLMError(Exception):
    """Provider failure (network, refusal, invalid output). Retryable by the job queue."""


@dataclass
class Usage:
    input_tokens: int = 0
    output_tokens: int = 0


class LLMProvider(Protocol):
    name: str
    fast_model: str
    smart_model: str

    async def structured(self, *, system: str, user: str, schema: type[T], smart: bool = False) -> tuple[T, Usage]:
        """Return a validated instance of `schema`."""
        ...

    async def chat(self, *, system: str, messages: list[dict]) -> tuple[str, Usage]:
        """Plain multi-turn answer with the smart model. messages: [{"role": "user"|"assistant", "content": str}]"""
        ...


@lru_cache
def get_llm() -> LLMProvider | None:
    """None means AI_PROVIDER=extractive (no LLM configured)."""
    provider = settings.ai_provider
    fast, smart = settings.models
    if provider == "extractive":
        return None
    if provider == "anthropic":
        from app.llm.anthropic_provider import AnthropicProvider

        return AnthropicProvider(fast, smart)
    from app.llm.openai_provider import OpenAICompatibleProvider

    if provider == "openai":
        key, base = settings.openai_api_key, settings.openai_base_url
    elif provider == "gemini":
        key, base = settings.gemini_api_key, "https://generativelanguage.googleapis.com/v1beta/openai/"
    elif provider == "ollama":
        key, base = None, settings.ollama_base_url
    else:  # openai_compatible
        key, base = settings.openai_api_key, settings.openai_base_url
    return OpenAICompatibleProvider(provider, fast, smart, api_key=key.get_secret_value() if key else "none",
                                    base_url=base)


def provider_status() -> dict:
    llm = get_llm()
    configured = llm is not None
    missing = None
    if settings.ai_provider == "anthropic" and not settings.anthropic_api_key:
        missing = "ANTHROPIC_API_KEY (or an `ant auth login` profile)"
    elif settings.ai_provider == "openai" and not settings.openai_api_key:
        missing = "OPENAI_API_KEY"
    elif settings.ai_provider == "gemini" and not settings.gemini_api_key:
        missing = "GEMINI_API_KEY"
    elif settings.ai_provider == "openai_compatible" and not settings.openai_base_url:
        missing = "OPENAI_BASE_URL"
    return {
        "provider": settings.ai_provider,
        "configured": configured,
        "fast_model": llm.fast_model if llm else None,
        "smart_model": llm.smart_model if llm else None,
        "missing": missing,
    }
