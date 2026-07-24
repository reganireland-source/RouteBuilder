import json
import os
from .provider import LLMProvider


class AnthropicProvider(LLMProvider):
    def __init__(self):
        import anthropic
        self._client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        response = self._client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system_prompt,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown code fences if the model wraps its output
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)

    # Default vision model for the Outage Parser. Sonnet is stronger than the
    # Haiku used for route-search NLP, which matters for reading a messy
    # screenshot AND fuzzy-matching cable names to segment ids. Override with
    # the OUTAGE_PARSER_MODEL env var if the account uses a different id.
    _VISION_MODEL = os.getenv("OUTAGE_PARSER_MODEL", "claude-sonnet-5")

    def complete_json_multimodal(
        self,
        system_prompt: str,
        content_blocks: list,
        model: str | None = None,
        max_tokens: int = 4096,
    ) -> dict:
        """Vision-capable JSON completion (see LLMProvider.complete_json_multimodal).

        content_blocks is passed straight through as the Anthropic user-message
        content, so it may contain text blocks and image blocks, e.g.:
          [{"type": "text", "text": "..."},
           {"type": "image", "source": {"type": "base64",
              "media_type": "image/png", "data": "<b64>"}}]
        """
        response = self._client.messages.create(
            model=model or self._VISION_MODEL,
            max_tokens=max_tokens,
            system=system_prompt,
            messages=[{"role": "user", "content": content_blocks}],
        )
        text = response.content[0].text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        return json.loads(text)
