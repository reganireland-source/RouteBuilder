# ─────────────────────────────────────────────────────────────────────────────
# openai_provider.py — OpenAI / Azure OpenAI implementation of LLMProvider.
#
# Selected by get_provider() (app/nlp/provider.py) when either
# OPENAI_API_KEY or AZURE_OPENAI_ENDPOINT is set (and no ANTHROPIC_API_KEY
# takes priority — see that module). Backs only the text-only JSON
# completion used by app/nlp/parser.py's natural-language route search; it
# does NOT override the multimodal methods, so calling
# complete_json_multimodal/stream_json_multimodal on this provider falls
# back to LLMProvider's default (which raises NotImplementedError for
# complete_json_multimodal) — the Outage Parser's vision feature therefore
# requires ANTHROPIC_API_KEY regardless of what is configured here.
# ─────────────────────────────────────────────────────────────────────────────
import json
import os
from .provider import LLMProvider


# Review finding #19: the OpenAI SDK's default timeout is 10 minutes, so a
# hanging upstream would pin a backend worker for that long — an easy way to
# exhaust the pool from an unauthenticated endpoint. 30s is generous for a small
# JSON extraction against gpt-4o-mini. Override with NLP_TIMEOUT_SECONDS.
_REQUEST_TIMEOUT = float(os.getenv("NLP_TIMEOUT_SECONDS", "30"))


class OpenAIProvider(LLMProvider):
    """LLMProvider backed by either the public OpenAI API or an Azure
    OpenAI deployment, selected at construction time by whether
    AZURE_OPENAI_ENDPOINT is set. Only complete_json is implemented; the
    multimodal methods use LLMProvider's defaults (see module docstring)."""

    def __init__(self):
        """Pick and construct the underlying OpenAI SDK client.

        Branches on AZURE_OPENAI_ENDPOINT:
          - Set → build an AzureOpenAI client from AZURE_OPENAI_API_KEY,
            the endpoint, and AZURE_OPENAI_API_VERSION (default
            "2024-02-01"); the model to call is the DEPLOYMENT name
            (AZURE_OPENAI_DEPLOYMENT, default "gpt-4o-mini" — on Azure this
            is actually the name of a deployment, not necessarily a literal
            model id, but the default string matches a commonly-used
            deployment name).
          - Unset → build a plain OpenAI client from OPENAI_API_KEY, with
            OPENAI_MODEL (default "gpt-4o-mini") as the model to call.

        Both branches import their respective `openai` client class lazily
        (inside the branch) rather than at module top level, and both pass
        the shared _REQUEST_TIMEOUT (see #19 above) as an explicit
        request-level timeout so a hung upstream cannot pin a worker
        indefinitely.
        """
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
        """LLMProvider.complete_json implementation: a single Chat
        Completions call with response_format={"type": "json_object"}, which
        tells the OpenAI API to constrain its own output to valid JSON (so,
        unlike the Anthropic path, no markdown-fence stripping is needed
        here — the API guarantees a bare JSON string in the response
        content). Capped at 1024 output tokens. Raises whatever
        json.loads or the OpenAI SDK raises on failure; the caller
        (app/nlp/parser.py → app/api/nlp.py) is responsible for turning
        that into a client-safe error.
        """
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
