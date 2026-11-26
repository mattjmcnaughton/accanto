"""Performance tracing through Logfire (OpenTelemetry), within Constitution §6.

Traces carry operation names, timings, SQL with placeholders, identifiers,
counts and error codes. Every integration below is configured to leave out
financial values, free text, credentials and tokens; see docs/technical/
telemetry.md before adding a span or an integration.

Nothing is exported unless LOGFIRE_TOKEN is set, so development and tests send
nothing even when other Logfire credentials are in the environment.

Exception text can quote anything (a database error names the value it
rejected), so spans leave the process only through SafeSpanExporter, which
keeps exception types and stack frames and drops every message.
"""

import re
from collections.abc import Sequence

import logfire
from fastapi import FastAPI
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.trace import Event, ReadableSpan
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SpanExporter,
    SpanExportResult,
)
from opentelemetry.trace import Status

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


# Traceback lines that carry no exception text: headers, frames with their
# source line and carets, and exception class names without their message.
_HEADER = re.compile(
    r"Traceback \(most recent call last\):|"
    r"The above exception was the direct cause of the following exception:|"
    r"During handling of the above exception, another exception occurred:"
)
_FRAME = re.compile(r'  File ".*", line \d+, in \S+')
_SOURCE = re.compile(r"    \S.*")
_CARETS = re.compile(r"\s+[~^]+")
_EXCEPTION = re.compile(
    r"((?:\w+\.)*[A-Z]\w*(?:Error|Exception|Warning|Exit|Interrupt|Iteration|Group))"
    r"(?::.*)?"
)


def safe_stacktrace(stacktrace: str) -> str:
    """Frames and exception types only; messages, which may quote values, go."""
    kept, previous = [], None
    for line in stacktrace.splitlines():
        if _HEADER.fullmatch(line) or _FRAME.fullmatch(line):
            kind = "frame" if line.startswith("  File") else "header"
        elif previous == "frame" and _SOURCE.fullmatch(line):
            kind = "source"
        elif previous == "source" and _CARETS.fullmatch(line):
            kind = "carets"
        elif match := _EXCEPTION.fullmatch(line):
            kind, line = "exception", match[1]
        else:
            previous = None
            continue
        kept.append(line)
        previous = kind
    return "\n".join(kept)


def _safe_event(event: Event) -> Event:
    if event.name != "exception":
        return event
    attributes = {
        k: v for k, v in (event.attributes or {}).items() if k != "exception.message"
    }
    if isinstance(trace := attributes.get("exception.stacktrace"), str):
        attributes["exception.stacktrace"] = safe_stacktrace(trace)
    return Event(event.name, attributes, event.timestamp)


def safe_span(span: ReadableSpan) -> ReadableSpan:
    return ReadableSpan(
        name=span.name,
        context=span.context,
        parent=span.parent,
        resource=span.resource,
        attributes=span.attributes,
        events=[_safe_event(event) for event in span.events],
        links=span.links,
        kind=span.kind,
        status=Status(span.status.status_code),  # the description is exception text
        start_time=span.start_time,
        end_time=span.end_time,
        instrumentation_scope=span.instrumentation_scope,
    )


class SafeSpanExporter(SpanExporter):
    """Removes exception messages from every span before it leaves the process."""

    def __init__(self, exporter: SpanExporter):
        self.exporter = exporter

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        return self.exporter.export([safe_span(span) for span in spans])

    def shutdown(self) -> None:
        self.exporter.shutdown()

    def force_flush(self, timeout_millis: int = 30000) -> bool:
        return self.exporter.force_flush(timeout_millis)


def instrument_agents() -> None:
    """Trace agent runs without content. Called when the agent service loads, not
    at startup, because importing pydantic-ai takes seconds on the Box. Logfire's
    proxy provider sends these spans to the exporter configured in instrument()."""
    logfire.instrument_pydantic_ai(include_content=False, include_binary_content=False)


def instrument(app: FastAPI) -> None:
    """Configure export once per process and trace this app."""
    global _configured
    if not _configured:
        token = settings.logfire_token.get_secret_value()
        base = settings.logfire_base_url.rstrip("/")
        headers = {"Authorization": token}
        # Logfire's own exporter is off: spans go only through SafeSpanExporter.
        logfire.configure(
            send_to_logfire=False,
            additional_span_processors=[
                BatchSpanProcessor(
                    SafeSpanExporter(
                        OTLPSpanExporter(endpoint=f"{base}/v1/traces", headers=headers)
                    )
                )
            ]
            if token
            else [],
            metrics=logfire.MetricsOptions(
                additional_readers=[
                    PeriodicExportingMetricReader(
                        OTLPMetricExporter(
                            endpoint=f"{base}/v1/metrics", headers=headers
                        )
                    )
                ]
                if token
                else []
            ),
            service_name="accanto",
            environment=settings.logfire_environment,
            console=False,  # structlog owns stdout
            inspect_arguments=False,  # never derive attributes from source code
            distributed_tracing=False,  # ignore trace context and baggage from clients
        )
        logfire.instrument_sqlalchemy(engine=db.engine)
        logfire.instrument_httpx()
        _configured = True
    logfire.instrument_fastapi(
        app, request_attributes_mapper=request_attributes, excluded_urls=EXCLUDED_URLS
    )
