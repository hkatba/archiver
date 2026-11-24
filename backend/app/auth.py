"""Authentication: scrypt password hashes + opaque bearer tokens (sha256-hashed at rest).

Web app: token in an httpOnly SameSite=Lax cookie. Extension / iOS / scripts: `Authorization: Bearer <token>`.
"""

import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import ApiToken, User

COOKIE_NAME = "cairn_session"
_SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **_SCRYPT)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt_hex, dk_hex = stored.split("$")
    except ValueError:
        return False
    if algo != "scrypt":
        return False
    dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **_SCRYPT)
    return hmac.compare_digest(dk.hex(), dk_hex)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_token(db: Session, user: User, name: str, kind: str = "session",
                ttl_days: int | None = None) -> str:
    token = "cairn_" + secrets.token_urlsafe(32)
    expires = datetime.now(UTC) + timedelta(days=ttl_days) if ttl_days else None
    db.add(ApiToken(user_id=user.id, name=name, kind=kind, token_hash=hash_token(token), expires_at=expires))
    db.commit()
    return token


def _token_from_request(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get(COOKIE_NAME)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = _token_from_request(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    row = db.execute(
        select(ApiToken, User).join(User, User.id == ApiToken.user_id)
        .where(ApiToken.token_hash == hash_token(token))
    ).first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked token")
    tok, user = row
    now = datetime.now(UTC)
    if tok.expires_at and tok.expires_at < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    if not tok.last_used_at or now - tok.last_used_at > timedelta(minutes=5):
        db.execute(update(ApiToken).where(ApiToken.id == tok.id).values(last_used_at=now))
        db.commit()
    request.state.token_id = tok.id
    return user


class RateLimiter:
    """Sliding-window limiter keyed by an arbitrary string.
    shortcut: in-process memory; move to Redis/Postgres when running more than one API replica."""

    def __init__(self, limit: int, window_seconds: float):
        self.limit, self.window = limit, window_seconds
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def check(self, key: str) -> None:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests, slow down")
        q.append(now)


login_limiter = RateLimiter(10, 60)
ingest_limiter = RateLimiter(60, 60)
ai_limiter = RateLimiter(30, 60)


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=settings.cookie_secure, samesite="lax",
                        max_age=settings.session_ttl_days * 86400, path="/")
