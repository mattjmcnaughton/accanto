"""Report bug contracts (TDD 21).

The note is the only free text. Every context field is a constant, a count or
a pattern-checked token, so the stored context cannot carry page text, amounts
or names even from a client that tried to send them.
"""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from accanto.dtos.monthly import Input

Kind = Literal["bug", "idea", "fix"]
Status = Literal["open", "done", "wont_do"]
Screen = Literal[
    "home",
    "activity",
    "inbox",
    "review",
    "plans",
    "routines",
    "schedules",
    "projections",
    "savings",
    "investments",
    "giving",
    "loans",
    "settings",
    "more",
]
Token = Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]{1,64}$")]
# An API path with every identifier and value replaced by a placeholder.
PathTemplate = Annotated[
    str,
    StringConstraints(
        pattern=r"^/api(/([a-z][a-z0-9_-]{0,39}|:id|:value|\d{4}-\d{2}(-\d{2})?))*$",
        max_length=200,
    ),
]
Milliseconds = Annotated[int, Field(strict=True, ge=0, le=600_000)]
Pixels = Annotated[int, Field(strict=True, ge=0, le=20_000)]


class ApiCall(Input):
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"]
    path: PathTemplate
    # Null when the request never reached the server.
    status: Annotated[int, Field(strict=True, ge=100, le=599)] | None
    ms: Milliseconds
    code: Token | None


class ClientError(Input):
    # An exception's class name only: messages can quote what was rejected.
    name: Annotated[str, StringConstraints(pattern=r"^[A-Za-z][A-Za-z0-9_]{0,63}$")]


class Viewport(Input):
    width: Pixels
    height: Pixels
    pixel_ratio: Annotated[float, Field(ge=0.25, le=8)]


class ReportContext(Input):
    screen: Screen
    month: Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}$")] | None = None
    build: Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{7,40}$|^dev$")]
    viewport: Viewport
    theme: Literal["light", "dark"]
    # The browser's own product and platform string; no page content.
    user_agent: Annotated[str, Field(max_length=300)]
    api: Annotated[list[ApiCall], Field(max_length=20)]
    errors: Annotated[list[ClientError], Field(max_length=10)]


class ReportInput(Input):
    kind: Kind = "bug"
    note: Annotated[str, Field(min_length=1, max_length=2000)]
    context: ReportContext


class StatusInput(Input):
    status: Status
