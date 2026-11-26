"""Tag rules: names, archived tags on existing entries, and refunds."""

import pytest

from accanto.domains.tags import (
    MAX_PER_ENTRY,
    TagRejectionError,
    TagState,
    entry_tags,
    require_refund_tags,
    tag_name,
)

TAGS = {
    "trip": TagState(active=True),
    "kids": TagState(active=True),
    "old": TagState(active=False),
    "gone": TagState(active=False, deleted=True),
}


def test_names_collapse_whitespace_and_reject_blank_or_long():
    assert tag_name("  Italy   trip  2026 ") == "Italy trip 2026"
    with pytest.raises(TagRejectionError, match="Name the tag"):
        tag_name(" \t ")
    assert tag_name("x" * 120) == "x" * 120
    with pytest.raises(TagRejectionError, match="120"):
        tag_name("x" * 121)


def test_repeats_collapse_in_requested_order():
    assert entry_tags(["kids", "trip", "kids"], [], TAGS) == ["kids", "trip"]
    assert entry_tags([], ["trip"], TAGS) == []


def test_archived_tag_stays_on_an_entry_but_cannot_be_added():
    assert entry_tags(["old", "trip"], ["old"], TAGS) == ["old", "trip"]
    with pytest.raises(TagRejectionError) as error:
        entry_tags(["trip", "old"], ["trip"], TAGS)
    assert error.value.code == "archived_tag"


def test_deleted_or_unknown_tags_are_unavailable_even_if_kept():
    for tag in ("gone", "other-entity"):
        with pytest.raises(TagRejectionError) as error:
            entry_tags([tag], [tag], TAGS)
        assert error.value.code == "tag_not_found"


def test_tag_limit_counts_distinct_tags():
    many = {str(n): TagState(active=True) for n in range(MAX_PER_ENTRY + 1)}
    assert len(entry_tags(list(many)[:MAX_PER_ENTRY] * 2, [], many)) == MAX_PER_ENTRY
    with pytest.raises(TagRejectionError) as error:
        entry_tags(list(many), [], many)
    assert error.value.code == "too_many_tags"


def test_refund_cannot_choose_tags_even_an_empty_list():
    require_refund_tags(None)
    with pytest.raises(TagRejectionError, match="purchase's tags"):
        require_refund_tags([])
