import os
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Abstract LLM provider — swap implementations via env vars."""

    @abstractmethod
    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        """Complete a request and return the parsed JSON response."""
        ...


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
