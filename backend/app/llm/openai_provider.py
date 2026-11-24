"""Adapter for any OpenAI-compatible Chat Completions API: OpenAI, Gemini (OpenAI endpoint), Ollama, vLLM, ..."""

import json
import re

import openai
from pydantic import ValidationError

from app.llm import LLMError, T, Usage


def _json_from_text(text: str) -> dict:
    text = text.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", text, re.S)
    if fenced:
        text = fenced.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("no JSON object in model output")
    return json.loads(text[start : end + 1])


class OpenAICompatibleProvider:
    def __init__(self, name: str, fast_model: str, smart_model: str, *, api_key: str, base_url: str | None):
        self.name, self.fast_model, self.smart_model = name, fast_model, smart_model
        # Local models (Ollama) can be slow on CPU
        self.client = openai.AsyncOpenAI(api_key=api_key, base_url=base_url,
                                         timeout=600.0 if name == "ollama" else 120.0, max_retries=2)

    async def _complete(self, model: str, messages: list[dict], json_mode: bool) -> tuple[str, Usage]:
        try:
            resp = await self.client.chat.completions.create(
                model=model, messages=messages,
                response_format={"type": "json_object"} if json_mode else openai.omit,
            )
        except openai.AuthenticationError as e:
            raise LLMError(f"{self.name}: authentication failed, check the API key") from e
        except openai.RateLimitError as e:
            raise LLMError(f"{self.name}: rate limit reached; will retry later") from e
        except openai.APIStatusError as e:
            raise LLMError(f"{self.name}: API error {e.status_code}: {e.message}") from e
        except openai.APIConnectionError as e:
            hint = " Is the Ollama app running?" if self.name == "ollama" else ""
            raise LLMError(f"{self.name}: could not reach the model server at {self.client.base_url}.{hint}") from e
        usage = Usage(resp.usage.prompt_tokens if resp.usage else 0,
                      resp.usage.completion_tokens if resp.usage else 0)
        return resp.choices[0].message.content or "", usage

    async def structured(self, *, system: str, user: str, schema: type[T], smart: bool = False) -> tuple[T, Usage]:
        model = self.smart_model if smart else self.fast_model
        schema_json = json.dumps(schema.model_json_schema())
        messages = [
            {"role": "system", "content": f"{system}\n\nRespond with ONLY a JSON object matching this JSON Schema:\n"
                                          f"{schema_json}"},
            {"role": "user", "content": user},
        ]
        total = Usage()
        for attempt in range(2):  # one repair round if the model returns invalid JSON
            text, usage = await self._complete(model, messages, json_mode=True)
            total.input_tokens += usage.input_tokens
            total.output_tokens += usage.output_tokens
            try:
                return schema.model_validate(_json_from_text(text)), total
            except (ValueError, ValidationError) as e:
                if attempt == 1:
                    raise LLMError(f"{self.name}: model returned invalid structured output: {str(e)[:300]}") from e
                messages += [{"role": "assistant", "content": text},
                             {"role": "user", "content": f"That JSON was invalid: {str(e)[:500]}. "
                                                         "Return the corrected JSON object only."}]
        raise AssertionError("unreachable")

    async def chat(self, *, system: str, messages: list[dict]) -> tuple[str, Usage]:
        return await self._complete(self.smart_model, [{"role": "system", "content": system}, *messages],
                                    json_mode=False)
