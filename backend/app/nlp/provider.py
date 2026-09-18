import os
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Abstract LLM provider — swap implementations via env vars."""

    @abstractmethod
    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        """Complete a request and return the parsed JSON response."""
        ...

    def complete_json_multimodal(
        self,
        system_prompt: str,
        content_blocks: list,
        model: str | None = None,
        max_tokens: int = 4096,
    ) -> dict:
        """Complete a request whose user turn is a list of content blocks
        (a mix of {"type": "text", ...} and {"type": "image", ...}) and return
        the parsed JSON response.

        Used by the Outage Parser to read a screenshot/spreadsheet/pasted table
        and map it to structured outages in one call. `model` optionally
        overrides the provider's default (the parser uses a stronger vision
        model than the route-search NLP).

        Providers that cannot do this raise NotImplementedError; callers should
        surface a clear "this provider doesn't support image/table parsing"
        message.
        """
        raise NotImplementedError(
            "The configured LLM provider does not support multimodal (image/table) parsing. "
            "Set ANTHROPIC_API_KEY to use the Outage Parser."
        )

    def stream_json_multimodal(
        self,
        system_prompt: str,
        content_blocks: list,
        model: str | None = None,
        max_tokens: int = 4096,
    ):
        """Generator variant of complete_json_multimodal for progress reporting.

        Yields dicts as the model works:
          {"type": "progress", "tokens": <running output-token estimate>}
          {"type": "done", "data": <parsed JSON dict>, "output_tokens": <final>}

        The default implementation is non-streaming — it just does the blocking
        call and emits a single "done". Providers that can stream (Anthropic)
        override this to emit live "progress" events so the UI can show a token
        counter while a long parse (with thinking) is in flight.
        """
        data = self.complete_json_multimodal(system_prompt, content_blocks, model, max_tokens)
        yield {"type": "done", "data": data, "output_tokens": 0}


def get_provider() -> LLMProvider:
    """
    Select provider from available credentials:
      ANTHROPIC_API_KEY          → Claude (Haiku)
      OPENAI_API_KEY             → OpenAI (gpt-4o-mini by default)
      AZURE_OPENAI_ENDPOINT      → Azure OpenAI (uses AZURE_OPENAI_API_KEY + AZURE_OPENAI_DEPLOYMENT)
    """
    if os.getenv("ANTHROPIC_API_KEY"):
        from .anthropic_provider import AnthropicProvider
        return AnthropicProvider()
    if os.getenv("OPENAI_API_KEY") or os.getenv("AZURE_OPENAI_ENDPOINT"):
        from .openai_provider import OpenAIProvider
        return OpenAIProvider()
    raise RuntimeError(
        "No LLM provider configured. "
        "Set ANTHROPIC_API_KEY (Claude) or OPENAI_API_KEY / AZURE_OPENAI_ENDPOINT (OpenAI/Azure)."
    )
