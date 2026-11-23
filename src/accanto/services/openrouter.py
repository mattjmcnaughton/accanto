"""Model resolution for the built-in agent (TDD 03), after aleph's openrouter.py.

A thin factory: pydantic-ai's OpenRouter provider owns the protocol. Built models
are cached per (id, key) so each request does not open a new HTTP pool. Every
request is routed only to zero-data-retention endpoints (PRD AG-04, AG-09).
"""

from urllib.parse import urlsplit

from pydantic_ai.models import Model
from pydantic_ai.models.openrouter import OpenRouterModel, OpenRouterModelSettings
from pydantic_ai.providers.openrouter import OpenRouterProvider

from accanto.services.stub_model import build_stub_model

STUB_MODEL_ID = "stub"
ZDR_SETTINGS = OpenRouterModelSettings(
    openrouter_provider={"zdr": True, "data_collection": "deny"}
)
_cache: dict[tuple[str, str], OpenRouterModel] = {}


class AgentUnavailableError(Exception):
    """The agent cannot run with this configuration; the message is safe to show."""


def agent_model_id(config) -> str:
    """The configured model id, refusing stub on a public HTTPS origin."""
    model_id = config.agent_model.strip()
    if not model_id:
        raise AgentUnavailableError("An operator must set AGENT_MODEL.")
    if model_id == STUB_MODEL_ID:
        origin = urlsplit(config.browser_origin or "")
        if origin.scheme == "https" and origin.hostname not in {
            "localhost",
            "127.0.0.1",
            "test",
        }:
            raise AgentUnavailableError("AGENT_MODEL=stub is for tests only.")
        return model_id
    if not config.openrouter_api_key.get_secret_value():
        raise AgentUnavailableError("An operator must set OPENROUTER_API_KEY.")
    return model_id


def resolve_model(config) -> Model:
    model_id = agent_model_id(config)
    if model_id == STUB_MODEL_ID:
        return build_stub_model()
    key = config.openrouter_api_key.get_secret_value()
    model = _cache.get((model_id, key))
    if model is None:
        model = OpenRouterModel(
            model_id,
            provider=OpenRouterProvider(api_key=key),
            settings=ZDR_SETTINGS,
        )
        _cache[(model_id, key)] = model
    return model


def provider_label(config) -> str:
    """What Settings shows the owner before they opt in."""
    try:
        model_id = agent_model_id(config)
    except AgentUnavailableError:
        return "Not configured"
    if model_id == STUB_MODEL_ID:
        return "Deterministic test model (no provider; nothing leaves Accanto)"
    return f"{model_id} through OpenRouter, zero-data-retention endpoints only"
