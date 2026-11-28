"""Browser sign-in, metadata and logout with no provider tokens in responses."""

from typing import Annotated, Literal

import logfire
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field

from accanto.routers.authentication import SESSION_COOKIE, BrowserToken, Session, Token
from accanto.services.access import AuthenticatedActor, RejectionError, revoke_session
from accanto.services.browser_auth import (
    account_metadata,
    admit_identity,
    begin_login,
    consume_login,
    csrf_token,
    sign_in_time_zone,
)

router = APIRouter(prefix="/api/auth", tags=["browser authentication"])
LOGIN_COOKIE = "accanto_login"
# The browser's time zone, for an Entity created at this sign-in. Not a secret.
ZONE_COOKIE = "accanto_login_zone"


def no_store(response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    return response


def set_cookie(response, name, value, max_age):
    response.set_cookie(
        name,
        value,
        max_age=max_age,
        secure=True,
        httponly=True,
        samesite="lax",
        path="/",
    )


@router.get("/login")
async def login(request: Request, session: Session):
    provider = request.app.state.oidc_provider
    provider.configured()
    state, binding, nonce, verifier = await begin_login(session)
    try:
        url = await provider.authorization_url(state, nonce, verifier)
    except Exception:
        raise RejectionError(
            "sign_in_unavailable", "Sign-in provider is unavailable. Try again.", 503
        ) from None
    response = no_store(RedirectResponse(url, status_code=302))
    set_cookie(response, LOGIN_COOKIE, binding, 600)
    set_cookie(
        response, ZONE_COOKIE, sign_in_time_zone(request.query_params.get("tz")), 600
    )
    return response


@router.get("/callback")
async def callback(request: Request, session: Session):
    # Do not expose authorization codes/state through server access-log query strings.
    query = request.query_params
    request.scope["query_string"] = b""
    state, code = query.get("state"), query.get("code")
    binding = request.cookies.get(LOGIN_COOKIE)
    if not state or not binding:
        raise RejectionError(
            "invalid_login", "Sign-in expired or is invalid. Start again.", 401
        )
    transaction = await consume_login(session, state, binding)
    if not code or query.get("error"):
        raise RejectionError(
            "invalid_login", "Sign-in was not completed. Start again.", 401
        )
    try:
        claims = await request.app.state.oidc_provider.identity(
            code, transaction["nonce"], transaction["verifier"]
        )
    except Exception:
        raise RejectionError(
            "invalid_identity", "Sign-in could not be verified. Start again.", 401
        ) from None
    try:
        issued = await admit_identity(
            session,
            claims,
            request.app.state.auth_settings,
            sign_in_time_zone(request.cookies.get(ZONE_COOKIE)),
        )
    except RejectionError as error:
        # A person, not a script, lands here: show the sign-in page with a reason.
        if error.code != "identity_not_admitted":
            raise
        return no_store(RedirectResponse("/?refused=not_invited", status_code=303))
    response = no_store(RedirectResponse("/", status_code=303))
    set_cookie(response, SESSION_COOKIE, issued["token"], 12 * 60 * 60)
    response.delete_cookie(
        LOGIN_COOKIE, secure=True, httponly=True, samesite="lax", path="/"
    )
    response.delete_cookie(
        ZONE_COOKIE, secure=True, httponly=True, samesite="lax", path="/"
    )
    return response


@router.get("/session")
async def current_session(request: Request, session: Session, token: Token):
    result = await account_metadata(session, token)
    result["screen_timing"] = bool(
        request.app.state.auth_settings.logfire_token.get_secret_value()
    )
    result["csrf_token"] = (
        csrf_token(request.cookies[SESSION_COOKIE], request.app.state.auth_settings)
        if isinstance(token, AuthenticatedActor)
        else None
    )
    return no_store(JSONResponse(result))


Milliseconds = Annotated[int, Field(strict=True, ge=0, le=86_400_000)]


class ScreenTiming(BaseModel):
    screen: Literal[
        "home",
        "activity",
        "inbox",
        "review",
        "plans",
        "routines",
        "schedules",
        "alerts",
        "projections",
        "savings",
        "investments",
        "giving",
        "loans",
        "settings",
        "more",
    ]
    cold: bool = Field(strict=True)
    shell_ms: Milliseconds
    inbox_ms: Milliseconds
    long_task_ms: Milliseconds
    event_ms: Milliseconds
    api_window_ms: Milliseconds
    api_count: int = Field(strict=True, ge=0, le=100_000)


@router.post("/screen-timing", status_code=204)
async def screen_timing(timing: ScreenTiming, token: BrowserToken):
    with logfire.span("browser.screen", **timing.model_dump()):
        return Response(status_code=204)


@router.post("/logout")
async def logout(session: Session, token: Token):
    if not isinstance(token, AuthenticatedActor) or token.credential_kind != "session":
        raise RejectionError("invalid_credential", "Browser session required.", 401)
    await revoke_session(session, token)
    response = no_store(JSONResponse({"signed_out": True}))
    response.delete_cookie(
        SESSION_COOKIE, secure=True, httponly=True, samesite="lax", path="/"
    )
    return response
