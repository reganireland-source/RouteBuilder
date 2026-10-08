# ─────────────────────────────────────────────────────────────────────────────
# provider.py — LLM provider abstraction + selection.
#
# WHY THIS EXISTS. RouteBuilder's NLP features (natural-language route
# search in app/nlp/parser.py, and the Outage Parser's screenshot/table
# reading) call an LLM, but the app must not hard-wire itself to one vendor:
# an org may already have an Anthropic key, an OpenAI key, or an Azure
# OpenAI deployment, and none of the calling code should need to know or
# care which. This module is the seam that makes that swappable:
#
#   - LLMProvider: the abstract interface every concrete provider
#     implements (one JSON-completion method, plus optional multimodal
#     variants — see each method's docstring for exactly what a caller can
#     rely on and what a minimal provider is allowed to skip).
#   - get_provider(): the factory that decides WHICH concrete provider to
#     instantiate, purely from which environment variables are set — no
#     config file, no explicit provider argument from callers.
#
# Concrete implementations live in sibling modules and are imported lazily
# (only once get_provider() has decided which one is needed), so that an
# install with only an Anthropic key never needs the `openai` package
# installed, and vice versa:
#   - app/nlp/anthropic_provider.py — AnthropicProvider (Claude).
#   - app/nlp/openai_provider.py    — OpenAIProvider (OpenAI or Azure OpenAI).
#
# Callers (app/api/nlp.py's nlp_parse(), and the Outage Parser) always go
# through get_provider() and the LLMProvider interface — never import a
# concrete provider class directly — so a new provider can be added here
# without touching call sites.
# ─────────────────────────────────────────────────────────────────────────────
import os
from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Abstract LLM provider — swap implementations via env vars.

    Every concrete provider (AnthropicProvider, OpenAIProvider) implements
    complete_json() at minimum. The multimodal methods below have working
    default implementations so a text-only provider does not have to
    override anything to remain a valid LLMProvider; only a provider that
    actually supports vision (currently just AnthropicProvider) overrides
    them to do something more than raise/wrap.
    """

    @abstractmethod
    def complete_json(self, system_prompt: str, user_prompt: str) -> dict:
        """Complete a request and return the parsed JSON response.

        Params:
          - system_prompt: the full instructions for the model (e.g.
            app/nlp/parser.py's SYSTEM_PROMPT, already filled in with the
            live network catalogue).
          - user_prompt: the end user's free-text input.
        Returns: a plain dict already parsed from the model's JSON reply.
        A provider is responsible for stripping any markdown code fences the
        model may have wrapped the JSON in before parsing — see e.g.
        anthropic_provider.py's _extract_json_text().
        Raises: whatever the underlying SDK/JSON-parsing raises on failure
        (a malformed response, an API/network error, etc.) — callers such as
        app/api/nlp.py catch broadly and turn this into a generic client
        error so no upstream error detail leaks to an unauthenticated
        endpoint (see that router's own docstring, "Review finding #19").
        """
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
    Select and instantiate the LLM provider to use, purely from which
    environment variables are set on the server — there is no explicit
    "which provider" config value, and callers never choose one directly.

    Selection order (first match wins — checked top to bottom):
      ANTHROPIC_API_KEY          → Claude (Haiku) via AnthropicProvider.
      OPENAI_API_KEY             → OpenAI (gpt-4o-mini by default) via
                                    OpenAIProvider.
      AZURE_OPENAI_ENDPOINT      → Azure OpenAI (uses AZURE_OPENAI_API_KEY +
                                    AZURE_OPENAI_DEPLOYMENT) also via
                                    OpenAIProvider, which branches internally
                                    on whether AZURE_OPENAI_ENDPOINT is set.

    Anthropic is checked first: if both an Anthropic key AND an OpenAI/Azure
    one happen to be set, Anthropic wins, and the Outage Parser's vision
    features (which currently only AnthropicProvider implements) become
    available as a side effect.

    The concrete provider module is imported only inside the matching
    branch (not at module top level) — see this module's own docstring for
    why: an install with only one provider's credentials never needs the
    other provider's SDK package installed.

    Returns: a ready-to-use LLMProvider instance (a fresh one on every call
    — this is NOT a cached singleton, so each request to
    POST /api/nlp/parse currently re-constructs the underlying SDK client).

    Raises: RuntimeError if none of the above environment variables are set
    — no LLM provider is configured at all. Callers (e.g. app/api/nlp.py's
    nlp_parse()) catch this specifically and turn it into an HTTP 503
    ("service unavailable"), distinct from a runtime failure of an otherwise
    working provider.
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
