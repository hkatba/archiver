"""Anthropic Claude adapter (official `anthropic` SDK)."""

import anthropic

from app.config import settings
from app.llm import LLMError, T, Usage


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, fast_model: str, smart_model: str):
        self.fast_model, self.smart_model = fast_model, smart_model
        key = settings.anthropic_api_key.get_secret_value() if settings.anthropic_api_key else None
        # No key -> SDK resolves ANTHROPIC_AUTH_TOKEN / `ant auth login` profile itself
        self.client = anthropic.AsyncAnthropic(api_key=key, timeout=120.0, max_retries=2)

    async def structured(self, *, system: str, user: str, schema: type[T], smart: bool = False) -> tuple[T, Usage]:
        try:
            response = await self.client.messages.parse(
                model=self.smart_model if smart else self.fast_model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": user}],
                output_format=schema,
                # Routine extraction/classification: low effort keeps cost and latency down
                output_config={"effort": "medium" if smart else "low"},
            )
        except anthropic.BadRequestError as e:
            raise LLMError(f"Anthropic rejected the request: {e.message}") from e
        except anthropic.AuthenticationError as e:
            raise LLMError("Anthropic authentication failed: check ANTHROPIC_API_KEY") from e
        except anthropic.RateLimitError as e:
            raise LLMError("Anthropic rate limit reached; will retry later") from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError("Could not reach the Anthropic API") from e
        usage = Usage(response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason == "refusal":
            category = response.stop_details.category if response.stop_details else None
            raise LLMError(f"The model declined to analyze this page (category: {category})")
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            raise LLMError(f"Model output was incomplete (stop_reason={response.stop_reason})")
        return response.parsed_output, usage

    async def chat(self, *, system: str, messages: list[dict]) -> tuple[str, Usage]:
        try:
            response = await self.client.beta.messages.create(
                model=self.smart_model,
                max_tokens=16000,
                system=system,
                messages=messages,
                output_config={"effort": "medium"},
                # On a policy decline the API retries on a fallback model chosen by refusal category
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError as e:
            raise LLMError("Anthropic rate limit reached; try again shortly") from e
        except anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic API error {e.status_code}: {e.message}") from e
        except anthropic.APIConnectionError as e:
            raise LLMError("Could not reach the Anthropic API") from e
        usage = Usage(response.usage.input_tokens, response.usage.output_tokens)
        if response.stop_reason == "refusal":
            raise LLMError("The model declined to answer this question")
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        return text, usage
