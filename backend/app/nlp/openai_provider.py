import json
import os
from .provider import LLMProvider


class OpenAIProvider(LLMProvider):
    def __init__(self):
        azure_endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        if azure_endpoint:
            from openai import AzureOpenAI
            self._client = AzureOpenAI(
                api_key=os.getenv("AZURE_OPENAI_API_KEY"),
                azure_endpoint=azure_endpoint,
                api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-02-01"),
            )
            self._model = os.getenv("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini")
        else:
            from openai import OpenAI
            self._client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
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
