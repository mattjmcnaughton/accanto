"""Same-origin credential and CSRF boundary for HTTP adapters."""

import hmac
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from accanto.db import get_session
from accanto.services.access import AuthenticatedActor, RejectionError, resolve_actor
from accanto.services.browser_auth import csrf_token

SESSION_COOKIE = "accanto_session"
Session = Annotated[AsyncSession, Depends(get_session)]


async def credential(request: Request, session: Session) -> str | AuthenticatedActor:
    token = request.cookies.get(SESSION_COOKIE)
    authorization = request.headers.get("authorization")
    if SESSION_COOKIE in request.cookies and authorization is not None:
        raise RejectionError(
            "ambiguous_credentials", "Use one authentication method.", 401
        )
    if token:
        config = request.app.state.auth_settings
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            expected = csrf_token(token, config)
            if request.headers.get("origin") != config.browser_origin.rstrip(
                "/"
            ) or not hmac.compare_digest(
                request.headers.get("x-csrf-token", "").encode(), expected.encode()
            ):
                raise RejectionError(
                    "csrf_rejected", "Refresh your session before trying again.", 403
                )
        async with session.begin():
            return await resolve_actor(session, token, "session")
    if not authorization or not authorization.startswith("Bearer "):
        raise RejectionError(
            "invalid_credential", "Sign in or supply a Bearer API key.", 401
        )
    return authorization.removeprefix("Bearer ")


Token = Annotated[str | AuthenticatedActor, Depends(credential)]
