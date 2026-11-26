"""Pure Tag rules (TDD 05): names, which tags an entry may carry, and refunds.

A Tag is a descriptive label. It never changes amounts, categories, funding
origins, Plans or totals, and tags overlap by design: tagged amounts are not
shares of any category total.
"""

from collections.abc import Iterable, Mapping
from dataclasses import dataclass

MAX_NAME = 120
MAX_PER_ENTRY = 20


class TagRejectionError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


@dataclass(frozen=True)
class TagState:
    active: bool
    deleted: bool = False


def tag_name(value: str) -> str:
    """Trim and collapse whitespace; names compare case-insensitively elsewhere."""
    name = " ".join(value.split())
    if not name:
        raise TagRejectionError("invalid_tag", "Name the tag.")
    if len(name) > MAX_NAME:
        raise TagRejectionError(
            "invalid_tag", f"Use at most {MAX_NAME} characters for a tag name."
        )
    return name


def entry_tags[T](
    requested: Iterable[T], current: Iterable[T], tags: Mapping[T, TagState]
) -> list[T]:
    """The tags an entry carries after a change, in first-requested order.

    Repeats collapse to one. Every tag must be a current Tag of the Entity. An
    archived tag can stay on an entry that already has it, but cannot be added.
    """
    chosen = list(dict.fromkeys(requested))
    if len(chosen) > MAX_PER_ENTRY:
        raise TagRejectionError(
            "too_many_tags", f"Use at most {MAX_PER_ENTRY} tags on one entry."
        )
    kept = set(current)
    for tag in chosen:
        state = tags.get(tag)
        if state is None or state.deleted:
            raise TagRejectionError("tag_not_found", "A chosen tag is unavailable.")
        if not state.active and tag not in kept:
            raise TagRejectionError(
                "archived_tag", "Restore the archived tag before adding it to entries."
            )
    return chosen


def require_refund_tags(requested: Iterable | None) -> None:
    """A linked refund carries its purchase's tags and cannot choose its own."""
    if requested is not None:
        raise TagRejectionError(
            "refund_tags",
            "A refund carries its purchase's tags. Change the purchase's tags instead.",
        )
