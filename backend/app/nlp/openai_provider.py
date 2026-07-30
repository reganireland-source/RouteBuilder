import json
import os
from .provider import LLMProvider


# Review finding #19: the OpenAI SDK's default timeout is 10 minutes, so a
# hanging upstream would pin a backend worker for that long — an easy way to
# exhaust the pool from an unauthenticated endpoint. 30s is generous for a small
# JSON extraction against gpt-4o-mini. Override with NLP_TIMEOUT_SECONDS.
_REQUEST_TIMEOUT = float(os.getenv("NLP_TIMEOUT_SECONDS", "30"))


class OpenAIProvider(LLMProvider):
    def __init__(self):
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if azure_endpoint:
            from openai import AzureOpenAI
            self._client = AzureOpenAI(
                api_key=os.getenv("AZURE_OPENAI_API_KEY"),
                azure_endpoint=azure_endpoint,
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
                # Explicit request timeout — see _REQUEST_TIMEOUT above (#19).
                timeout=_REQUEST_TIMEOUT,
            )
            self._model = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
        else:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=os.getenv("OPENAI_API_KEY"),
                # Explicit request timeout — see _REQUEST_TIMEOUT above (#19).
                timeout=_REQUEST_TIMEOUT,
            )
            self._model = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        response = self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=1024,
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
