"""What the built-in agent sees on a turn: catalog tools, deps and plain history.

Tool results are never stored or replayed: history is the owner's messages and
the agent's replies as plain text only (TDD 03).
"""

from datetime import UTC, datetime

from pydantic import ValidationError
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    TextPart,
    UserPromptPart,
)

from accanto.agents.sidebar import ToolSpec
from accanto.domains.entity import entity_today
from accanto.services.tools import CATALOG, CatalogTool


def _validator(tool: CatalogTool):
    def validate(arguments: dict) -> None:
        try:
            tool.input.model_validate(strip_draft(arguments)[0])
        except ValidationError as error:
            detail = error.errors()[0]
            where = ".".join(map(str, detail["loc"])) or "input"
            message = str(detail["msg"]).removeprefix("Value error, ")
            raise ValueError(f"{where}: {message}") from None

    return validate


DRAFT_FIELDS = {
    "uncertain_fields": {
        "type": "array",
        "items": {"type": "string"},
        "description": "Fields you are not sure of (for example from an image).",
    },
    "source_text": {
        "type": "string",
        "maxLength": 2000,
        "description": "The document text this draft relies on (untrusted).",
    },
}


def strip_draft(arguments: dict) -> tuple[dict, dict]:
    """Split sidebar-only draft annotations from the catalog input."""
    arguments = dict(arguments)
    draft = {key: arguments.pop(key) for key in DRAFT_FIELDS if key in arguments}
    return arguments, draft


def sidebar_specs() -> list[ToolSpec]:
    """The catalog as sidebar tools: no entity_id, no idempotency key."""
    specs = []
    for tool in CATALOG:
        schema = tool.input.model_json_schema()
        if tool.build is not None:
            schema = {
                **schema,
                "properties": {**schema.get("properties", {}), **DRAFT_FIELDS},
            }
        specs.append(ToolSpec(tool.name, tool.description, schema, _validator(tool)))
    return specs


def entity_day(time_zone: str):
    return entity_today(datetime.now(UTC), time_zone)


def history(rows) -> list[ModelMessage]:
    """Stored messages as plain text turns for the model."""
    result: list[ModelMessage] = []
    for row in rows:
        if row["role"] == "owner":
            text = row["content"]
            if row["image_count"]:
                text += f"\n[{row['image_count']} image(s) attached; not kept]"
            result.append(ModelRequest(parts=[UserPromptPart(content=text)]))
        else:
            result.append(ModelResponse(parts=[TextPart(content=row["content"])]))
    return result
