"""Whole-workspace synthetic fixtures, written through production application APIs."""

import argparse
import asyncio
import os
import subprocess
from datetime import UTC, date, datetime
from pathlib import Path
from uuid import UUID, uuid4

import httpx
from sqlalchemy import insert, select, text, update
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

DATABASE = "accanto_fixture_test"
MARKER = "accanto.synthetic-fixtures.v1"
ROOT = Path(__file__).resolve().parents[3]


UNSAFE_TARGET = (
    "Use a loopback asyncpg URL for accanto_fixture_test, without query options."
)


def checked_url(value):
    try:
        url = make_url(value)
    except Exception:
        # Parser errors can echo fragments of a malformed URL, credentials included.
        raise ValueError(UNSAFE_TARGET) from None
    if (
        url.drivername != "postgresql+asyncpg"
        or url.host not in {"127.0.0.1", "localhost", "::1"}
        or url.database != DATABASE
        or url.query
    ):
        raise ValueError(UNSAFE_TARGET)
    return url


def month_before(day, count):
    year, month = divmod(day.year * 12 + day.month - 1 - count, 12)
    return date(year, month + 1, 1).isoformat()


async def prepare(url, command, confirmed):
    if command == "reset" and not confirmed:
        raise ValueError(
            "Reset requires --confirm-reset. It erases this disposable "
            "fixture database, including manual synthetic edits."
        )
    admin = create_async_engine(
        url.set(database="postgres"), isolation_level="AUTOCOMMIT"
    )
    try:
        async with admin.connect() as connection:
            row = (
                (
                    await connection.execute(
                        text(
                            "SELECT shobj_description(oid, 'pg_database') AS marker "
                            "FROM pg_database WHERE datname=:name"
                        ),
                        {"name": DATABASE},
                    )
                )
                .mappings()
                .first()
            )
            if row is not None and row["marker"] != MARKER:
                raise ValueError(
                    "Refusing an existing database without the fixture marker."
                )
            if command == "reset" and row is not None:
                # Deliberately no FORCE: stop connected preview services first.
                await connection.execute(text(f"DROP DATABASE {DATABASE}"))
                row = None
            if row is None:
                if command not in {"seed", "reset"}:
                    raise ValueError("Seed the fixture database first.")
                await connection.execute(text(f"CREATE DATABASE {DATABASE}"))
                await connection.execute(
                    text(f"COMMENT ON DATABASE {DATABASE} IS '{MARKER}'")
                )
    finally:
        await admin.dispose()


async def populate(command, day):
    opening = month_before(day, 3)
    months = [month_before(day, n) for n in (2, 1, 0)]
    reserve = await command(
        "POST",
        "/savings-accounts",
        {
            "name": "Fixture reserve",
            "opening_date": opening,
            "opening_amount": "12000.00",
            "goals": [
                {
                    "name": "Emergency runway",
                    "kind": "ongoing",
                    "target": None,
                    "opening_amount": "8000.00",
                },
                {
                    "name": "New bicycle",
                    "kind": "finite",
                    "target": "1500.00",
                    "opening_amount": "750.00",
                },
                {
                    "name": "Finished project",
                    "kind": "finite",
                    "target": "100.00",
                    "opening_amount": "0.00",
                },
            ],
        },
    )
    goals = {g["name"]: g for g in reserve["goals"]}
    emergency, bicycle = goals["Emergency runway"]["uuid"], goals["New bicycle"]["uuid"]
    finished = goals["Finished project"]
    await command(
        "POST",
        f"/savings-accounts/{reserve['uuid']}/goals/{finished['uuid']}/complete",
        {
            "date": opening,
            "expected_revision": finished["revision"],
            "expected_return": "0.00",
        },
    )
    travel = await command(
        "POST",
        "/savings-accounts",
        {
            "name": "Fixture travel cash",
            "opening_date": opening,
            "opening_amount": "2400.00",
            "goals": [
                {
                    "name": "Mountain trip",
                    "kind": "finite",
                    "target": "3000.00",
                    "opening_amount": "2000.00",
                }
            ],
        },
    )
    old_cash = await command(
        "POST",
        "/savings-accounts",
        {
            "name": "Fixture archived cash",
            "opening_date": opening,
            "opening_amount": "0.00",
            "goals": [],
        },
    )
    await command(
        "POST",
        f"/savings-accounts/{old_cash['uuid']}/archive",
        {"expected_revision": old_cash["revision"]},
    )
    investment = await command(
        "POST",
        "/investments",
        {
            "name": "Fixture long-term fund",
            "target": "12000.00",
            "opening": {"date": opening, "amount": "28000.00"},
        },
    )
    await command(
        "POST", "/investments", {"name": "Fixture index fund", "target": None}
    )
    giving = await command(
        "POST",
        "/giving-recipients",
        {"name": "Fixture community kitchen", "target": "7200.00"},
    )
    retired = await command(
        "POST",
        "/giving-recipients",
        {"name": "Fixture retired campaign", "target": None},
    )
    await command(
        "PUT",
        f"/giving-recipients/{retired['uuid']}",
        {
            "name": retired["name"],
            "target": None,
            "active": False,
            "expected_revision": retired["revision"],
        },
    )
    loan = await command(
        "POST",
        "/debts",
        {
            "name": "Fixture education loan",
            "opening": {"date": opening, "amount": "8600.00"},
            "interest_rate_percent": "4.50",
            "monthly_payment": "180.00",
        },
    )
    await command(
        "POST",
        "/debts",
        {
            "name": "Fixture vehicle loan",
            "opening": {"date": opening, "amount": "12500.00"},
        },
    )
    base = {
        "name": "Everyday balance",
        "incomes": [
            {"name": "Primary pay", "amount": "6200.00"},
            {"name": "Occasional work", "amount": "400.00"},
        ],
        "fixed_costs": [
            {"name": "Rent", "amount": "2100.00", "frequency": "monthly"},
            {
                "name": "Education payment",
                "amount": "260.00",
                "frequency": "monthly",
                "debt_account_id": loan["uuid"],
            },
            {"name": "Annual insurance", "amount": "1440.18", "frequency": "annual"},
        ],
        "spending": "1719.98",
        "savings_funding": [{"account_id": reserve["uuid"], "amount": "200.00"}],
        "saving_goals": [
            {"goal_id": emergency, "amount": "700.00"},
            {"goal_id": bicycle, "amount": "300.00"},
        ],
        "investments": [{"destination_id": investment["uuid"], "amount": "1000.00"}],
        "giving": [{"destination_id": giving["uuid"], "amount": "600.00"}],
    }
    plan = await command("POST", "/plans", base)
    first = await command(
        "POST",
        f"/plans/{plan['plan_id']}/versions",
        {"expected_revision": plan["draft"]["revision"]},
    )
    # Preserve shared financial identities across versions, just like the worksheet.
    base["incomes"] = first["draft"]["incomes"]
    base["fixed_costs"] = [
        {
            k: line[k]
            for k in ("fixed_cost_id", "name", "amount", "frequency", "debt_account_id")
        }
        for line in first["draft"]["fixed_costs"]
    ]
    edited = await command(
        "PUT",
        f"/plans/{plan['plan_id']}/draft",
        {
            **base,
            "spending": "1619.98",
            "expected_revision": first["draft"]["revision"],
        },
    )
    second = await command(
        "POST",
        f"/plans/{plan['plan_id']}/versions",
        {"expected_revision": edited["draft"]["revision"]},
    )
    await command(
        "PUT",
        f"/plans/{plan['plan_id']}/draft",
        {**base, "expected_revision": second["draft"]["revision"]},
    )
    # New Plans need new income identities; their fixed-cost identities may be shared.
    base["incomes"] = [
        {"name": line["name"], "amount": line["amount"]} for line in base["incomes"]
    ]
    await command(
        "POST", "/plans", {**base, "name": "One cent over", "spending": "1719.99"}
    )
    await command(
        "POST",
        "/plans",
        {
            **base,
            "name": "Travel season",
            "spending": "2100.00",
            "savings_funding": [{"account_id": travel["uuid"], "amount": "1200.00"}],
        },
    )
    await command(
        "POST",
        "/plans",
        {
            "name": "Quiet month",
            "incomes": [{"name": "Not yet planned", "amount": "0.00"}],
            "fixed_costs": [],
            "spending": "0.00",
        },
    )
    incomes = first["version"]["incomes"]
    costs = first["version"]["fixed_costs"]
    for index, month in enumerate(months):
        await command(
            "POST", "/reviews", {"month": month, "version_id": first["version"]["uuid"]}
        )
        await command(
            "POST",
            "/activity",
            {
                "date": month,
                "category": "income",
                "source_id": incomes[0]["source_id"],
                "amount": "6200.00",
                "note": "Synthetic monthly pay",
            },
        )
        if index != 1:  # middle month is unknown; latest is explicitly zero
            await command(
                "POST",
                "/activity",
                {
                    "date": month,
                    "category": "income",
                    "source_id": incomes[1]["source_id"],
                    "amount": "400.00" if index == 0 else "0.00",
                },
            )
        for cost in costs[:2]:
            await command(
                "POST",
                "/activity",
                {
                    "date": month,
                    "category": "fixed_cost",
                    "fixed_cost_id": cost["fixed_cost_id"],
                    "debt_account_id": cost["debt_account_id"],
                    "amount": cost["amount"],
                },
            )
        for name, amount in (
            ("Groceries", "480.25"),
            ("Meals with friends", "182.70"),
            ("Books and hobbies", "95.00"),
        ):
            await command(
                "POST",
                "/activity",
                {
                    "date": month,
                    "category": "spending",
                    "amount": amount,
                    "note": f"Synthetic {name}",
                },
            )
        await command(
            "POST",
            "/activity",
            {
                "date": month,
                "category": "saving",
                "amount": "500.00",
                "saving_goal_id": emergency,
            },
        )
        await command(
            "POST",
            "/investment-activity",
            {"date": month, "amount": "800.00", "investment_id": investment["uuid"]},
        )
        await command(
            "POST",
            "/giving-activity",
            {"date": month, "amount": "450.00", "giving_recipient_id": giving["uuid"]},
        )
        await command(
            "POST",
            "/debt-observations",
            {
                "date": month,
                "amount": str(8400 - index * 200),
                "account_id": loan["uuid"],
            },
        )
        await command(
            "POST",
            "/investment-observations",
            {
                "date": month,
                "amount": str(29000 + index * 950),
                "account_id": investment["uuid"],
            },
        )
        if index == 0:
            review = await command("GET", f"/reviews/{month}")
            await command(
                "PUT",
                f"/reviews/{month}",
                {
                    "expected_revision": review["review"]["revision"],
                    "version_id": first["version"]["uuid"],
                    "note": "Synthetic review: insurance actual remains unknown.",
                    "reviewed": True,
                },
            )
    await command(
        "POST",
        "/savings-accounts/movements",
        {
            "kind": "reassignment",
            "date": months[-1],
            "from_goal_id": emergency,
            "to_goal_id": bicycle,
            "amount": "150.00",
            "note": "Synthetic goal adjustment",
        },
    )


async def run(args):
    raw_url = os.environ.get("ACCANTO_FIXTURE_DATABASE_URL", "")
    if not raw_url:
        raise ValueError(
            "Set ACCANTO_FIXTURE_DATABASE_URL (credentials are never printed)."
        )
    url = checked_url(raw_url)
    await prepare(url, args.command, args.confirm_reset)
    if args.command in {"seed", "reset"}:
        result = subprocess.run(
            ["uv", "run", "alembic", "upgrade", "head"],
            cwd=ROOT,
            env={**os.environ, "DATABASE_URL": raw_url},
            capture_output=True,
        )
        if result.returncode:
            raise RuntimeError(
                "Fixture migration failed; inspect local migration setup."
            )
    os.environ["DATABASE_URL"] = raw_url
    from accanto.app import create_app
    from accanto.db import get_session
    from accanto.models import monthly as m
    from accanto.services.api_keys import issue_key

    engine = create_async_engine(url, hide_parameters=True)
    sessions = async_sessionmaker(engine)
    try:
        async with sessions() as session, session.begin():
            existing = (await session.execute(select(m.entities))).mappings().all()
            if args.command in {"seed", "reset"} and existing:
                raise ValueError(
                    "Fixture database already populated. Inspect/verify it, "
                    "or explicitly reset; seed never overwrites work."
                )
            if not existing:
                if args.command not in {"seed", "reset"}:
                    raise ValueError("Fixture database is empty; seed first.")
                owner = await session.scalar(
                    insert(m.users)
                    .values(issuer=args.issuer, subject=args.subject)
                    .returning(m.users.c.id)
                )
                entity = await session.scalar(
                    insert(m.entities)
                    .values(
                        owner_id=owner,
                        name="Synthetic fixture workspace",
                        time_zone="UTC",
                    )
                    .returning(m.entities.c.uuid)
                )
            else:
                if (
                    len(existing) != 1
                    or existing[0]["name"] != "Synthetic fixture workspace"
                ):
                    raise ValueError(
                        "Unexpected workspace inventory; refusing to operate."
                    )
                owner, entity = existing[0]["owner_id"], existing[0]["uuid"]
            credential = await issue_key(session, owner, "Temporary fixture tooling")
        # The key is committed above; the finally below must revoke it on any failure.
        try:
            app = create_app()

            async def dependency():
                async with sessions() as session:
                    yield session

            app.dependency_overrides[get_session] = dependency
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://fixture",
                headers={"Authorization": f"Bearer {credential['key']}"},
            ) as client:

                async def command(method, path, body=None):
                    response = await client.request(
                        method,
                        f"/api/entities/{entity}{path}",
                        json=body,
                        headers={"Idempotency-Key": str(uuid4())},
                    )
                    if response.status_code != 200:
                        detail = response.json().get("detail", {})
                        code = (
                            detail.get("code", "validation")
                            if isinstance(detail, dict)
                            else "validation"
                        )
                        raise RuntimeError(
                            f"Fixture {method} {path.split('/')[1]} failed: "
                            f"{response.status_code} {code}"
                        )
                    return response.json()

                if args.command in {"seed", "reset"}:
                    await populate(command, args.as_of)
                    if args.agent != "off":
                        await enable_agent(sessions, owner, entity, args.agent)
                plans = await command("GET", "/plans")
                accounts = await command("GET", "/savings-accounts")
                activity = await command("GET", "/activity")
                if args.command != "inspect":
                    drafts = {
                        r["name"]: r
                        for p in plans
                        for r in p["revisions"]
                        if not r["saved"]
                    }
                    if (
                        len(plans) != 4
                        or drafts["Everyday balance"]["unassigned"] != "0.00"
                        or drafts["One cent over"]["unassigned"] != "-0.01"
                        or drafts["Quiet month"]["funding_total"] != "0.00"
                        or sum(r["saved"] for p in plans for r in p["revisions"]) != 2
                    ):
                        raise ValueError(
                            "Fixture Plan expectations differ; "
                            "inspect manual edits or seed completeness."
                        )
                    if len(accounts) != 3 or len(activity) < 20:
                        raise ValueError(
                            "Fixture account/activity inventory is incomplete."
                        )
                    months = sorted(
                        {
                            date.fromisoformat(entry["financial_date"])
                            .replace(day=1)
                            .isoformat()
                            for entry in activity
                        }
                    )
                    if len(months) != 3:
                        raise ValueError(
                            "Fixture activity must span exactly three Review months."
                        )
                    reviews = [
                        await command("GET", f"/reviews/{month}") for month in months
                    ]
                    if any(not item.get("review") for item in reviews):
                        raise ValueError("Fixture Review is missing for a month.")
                    if (
                        not reviews[0]["review"]["reviewed_at"]
                        or not reviews[1]["actual"]["income_incomplete"]
                        or reviews[2]["actual"]["income_incomplete"]
                        or reviews[2]["actual"]["income_recorded"] != "6200.00"
                    ):
                        raise ValueError(
                            "Fixture Reviews must distinguish unknown "
                            "from explicit zero."
                        )
                    for path, count in (
                        ("investments", 2),
                        ("giving-recipients", 2),
                        ("debts", 2),
                    ):
                        if len(await command("GET", f"/{path}")) != count:
                            raise ValueError(f"Fixture {path} inventory is incomplete.")
                print(
                    f"Fixture workspace: {entity}; {len(plans)} Plans, "
                    f"{len(accounts)} savings accounts, "
                    f"{len(activity)} activity entries."
                )
                print(
                    "Synthetic data only. Seed refuses duplicates; "
                    "reset erases manual synthetic edits after explicit confirmation."
                )
        finally:
            async with sessions() as session, session.begin():
                await session.execute(
                    update(m.keys)
                    .where(m.keys.c.uuid == UUID(credential["id"]))
                    .values(revoked_at=datetime.now(UTC))
                )
    finally:
        await engine.dispose()


async def enable_agent(sessions, owner, entity, mode):
    """Turn the assistant on through its service, as a short-lived browser session.

    Agent settings are browser-only over HTTP, so fixture tooling uses a fixture
    session that is revoked before returning. AGENT.md is synthetic guidance.
    """
    import hashlib

    from accanto.models import monthly as m
    from accanto.services import agent_settings
    from accanto.services.access import AuthenticatedActor, issue_session

    async with sessions() as session, session.begin():
        issued = await issue_session(session, owner)
    actor = AuthenticatedActor(
        owner,
        "session",
        UUID(issued["id"]),
        hashlib.sha256(issued["token"].encode()).hexdigest(),
    )
    try:
        async with sessions() as session:
            await agent_settings.update_settings(
                session,
                actor,
                entity,
                str(uuid4()),
                {
                    "enabled": True,
                    "mode": mode,
                    "instructions": (
                        "Sample Warehouse Club is groceries unless over $300.\n"
                        "Transfers between my own accounts are skipped."
                    ),
                    "expected_revision": 0,
                },
            )
    finally:
        async with sessions() as session, session.begin():
            await session.execute(
                update(m.sessions)
                .where(m.sessions.c.uuid == UUID(issued["id"]))
                .values(revoked_at=datetime.now(UTC))
            )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("seed", "inspect", "verify", "reset"))
    parser.add_argument(
        "--as-of", type=date.fromisoformat, default=datetime.now(UTC).date()
    )
    parser.add_argument("--issuer", default="http://127.0.0.1:8104")
    parser.add_argument("--subject", default="synthetic-user")
    parser.add_argument("--confirm-reset", action="store_true")
    parser.add_argument(
        "--agent",
        choices=("off", "read_only", "ask_first", "apply_directly"),
        default="off",
        help="Turn the assistant on in this Agent mode when seeding.",
    )
    args = parser.parse_args()
    try:
        asyncio.run(run(args))
    except (ValueError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    except Exception:
        parser.exit(
            1,
            "Fixture operation failed. Check local database availability "
            "and stop connected services before reset. "
            "Credentials and SQL parameters are suppressed.\n",
        )


if __name__ == "__main__":
    main()
