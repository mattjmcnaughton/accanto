"""Pure Spending subcategory rules (TDD 07).

A Spending subcategory is guilt-free spending's Assignment, as a Fixed cost is
for fixed costs: optional, at most one per entry, and Entity-defined. It changes
no amount, funding origin, Plan or total; it only groups guilt-free spending, so
the groups always add up to the category total.
"""

MAX_NAME = 120


class SubcategoryRejectionError(ValueError):
    def __init__(self, code: str, message: str):
        self.code = code
        super().__init__(message)


def subcategory_name(value: str) -> str:
    """Trim and collapse whitespace; names compare case-insensitively elsewhere."""
    name = " ".join(value.split())
    if not name:
        raise SubcategoryRejectionError(
            "invalid_spending_subcategory", "Name the subcategory."
        )
    if len(name) > MAX_NAME:
        raise SubcategoryRejectionError(
            "invalid_spending_subcategory",
            f"Use at most {MAX_NAME} characters for a subcategory name.",
        )
    return name


def check_assignment(category: str, *, active: bool, kept: bool) -> None:
    """Whether an entry may name a subcategory that exists in its Entity.

    Only guilt-free spending has subcategories. An archived subcategory stays on
    entries that already name it, so they can still be corrected, but it cannot
    be chosen for another entry.
    """
    if category != "spending":
        raise SubcategoryRejectionError(
            "spending_subcategory_category",
            "Only guilt-free spending selects a subcategory.",
        )
    if not active and not kept:
        raise SubcategoryRejectionError(
            "archived_spending_subcategory",
            "Restore the archived subcategory before choosing it.",
        )
