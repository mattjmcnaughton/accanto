"""Performance tracing through Logfire (OpenTelemetry), within Constitution §6.

Traces carry operation names, timings, SQL with placeholders, identifiers,
counts and error codes. Every integration below is configured to leave out
financial values, free text, credentials and tokens; see docs/technical/
telemetry.md before adding a span or an integration.

Nothing is exported unless LOGFIRE_TOKEN is set, so development and tests send
nothing even when other Logfire credentials are in the environment.
"""

import logfire
from fastapi import FastAPI

from accanto import db
from accanto.config import settings

# The OIDC callback URL carries the authorization code and state.
EXCLUDED_URLS = "/api/auth/callback,/healthz,/readyz"

_configured = False


def request_attributes(_request, attributes):
    """Keep where and why validation failed, never argument values.

    Endpoint arguments carry amounts and notes, and validation errors quote the
    rejected input in `input`, `msg` and `ctx`, so only `type` and `loc` remain.
    """
    errors = [
        {"type": error.get("type"), "loc": list(error.get("loc", ()))}
        for error in attributes.get("errors") or ()
    ]
    return {"errors": errors} if errors else None


def instrument(app: FastAPI) -> None:
    """Configure export once per process and trace this app."""
    global _configured
    if not _configured:
        token = settings.logfire_token.get_secret_value() or None
        logfire.configure(
            token=token,
            send_to_logfire=token is not None,
            service_name="accanto",
            environment=settings.logfire_environment,
            console=False,  # structlog owns stdout
            inspect_arguments=False,  # never derive attributes from source code
            distributed_tracing=False,  # ignore trace context and baggage from clients
        )
        logfire.instrument_sqlalchemy(engine=db.engine)
        logfire.instrument_httpx()
        logfire.instrument_pydantic_ai(
            include_content=False, include_binary_content=False
        )
        _configured = True
    logfire.instrument_fastapi(
        app, request_attributes_mapper=request_attributes, excluded_urls=EXCLUDED_URLS
    )
