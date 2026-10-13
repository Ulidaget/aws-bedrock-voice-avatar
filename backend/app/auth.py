"""Cognito JWT validation.

Validates the JWT presented by the browser when it opens the WebSocket,
BEFORE any Bedrock stream is opened. Uses the User Pool JWKS to verify the
signature, issuer, expiry, and (for access tokens) the client id.

In LOCAL DEV ONLY, AUTH_DISABLED=true bypasses validation and returns a
synthetic user. Never enable that in AWS.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx
from jose import jwt
from jose.utils import base64url_decode  # noqa: F401  (ensures python-jose extras present)

from .config import settings

logger = logging.getLogger(__name__)


@dataclass
class AuthedUser:
    sub: str
    username: str
    groups: list[str]  # C8: Cognito groups for per-agent access control


class AuthError(Exception):
    pass


class _JwksCache:
    def __init__(self) -> None:
        self._keys: Optional[dict] = None
        self._fetched_at = 0.0
        self._ttl = 3600.0

    async def keys(self) -> dict:
        now = time.time()
        if self._keys is None or (now - self._fetched_at) > self._ttl:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(settings.cognito_jwks_url)
                resp.raise_for_status()
                self._keys = {k["kid"]: k for k in resp.json()["keys"]}
                self._fetched_at = now
        return self._keys


_jwks = _JwksCache()


async def validate_token(token: str) -> AuthedUser:
    if settings.auth_disabled:
        logger.warning("AUTH_DISABLED is set — skipping JWT validation (dev only)")
        # Dev user is treated as admin so local testing can use any agent.
        return AuthedUser(sub="local-dev-user", username="local-dev", groups=["admin"])

    if not token:
        raise AuthError("missing token")

    try:
        headers = jwt.get_unverified_header(token)
        kid = headers.get("kid")
        keys = await _jwks.keys()
        key = keys.get(kid)
        if key is None:
            raise AuthError("unknown key id")

        claims = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            issuer=settings.cognito_issuer,
            options={
                # id vs access token audience is handled below.
                "verify_aud": False,
                # Cognito id_tokens carry an at_hash claim; jose tries to verify
                # it against an access_token we don't have. Skip it — we only
                # validate the id_token's signature, issuer and expiry.
                "verify_at_hash": False,
            },
        )
    except AuthError:
        raise
    except Exception as exc:  # pragma: no cover
        raise AuthError(f"token validation failed: {exc}") from exc

    # Accept either an ID token (aud == app client) or an access token
    # (client_id == app client). Enforce when a client id is configured.
    client_id = settings.cognito_app_client_id
    if client_id:
        aud = claims.get("aud")
        cid = claims.get("client_id")
        if aud != client_id and cid != client_id:
            raise AuthError("token audience/client mismatch")

    # C8: extract Cognito groups (list in the id_token; be robust to a string).
    raw_groups = claims.get("cognito:groups", [])
    if isinstance(raw_groups, str):
        groups = [g for g in raw_groups.replace(",", " ").split() if g]
    elif isinstance(raw_groups, list):
        groups = [str(g) for g in raw_groups]
    else:
        groups = []

    return AuthedUser(
        sub=claims.get("sub", "unknown"),
        username=claims.get("cognito:username") or claims.get("username") or "user",
        groups=groups,
    )
