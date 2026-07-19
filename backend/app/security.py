import hashlib
import hmac
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Request, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .database import get_db
from .models import Admin, AuthSession, ChildProfile

COOKIE_NAME = "kidtype_session"
hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)


def hash_secret(secret: str) -> str:
    return hasher.hash(secret)


def verify_secret(secret: str, encoded: str) -> bool:
    try:
        return hasher.verify(encoded, secret)
    except (VerifyMismatchError, InvalidHashError):
        return False


def token_digest(token: str, secret: str) -> str:
    return hmac.new(secret.encode(), token.encode(), hashlib.sha256).hexdigest()


def issue_session(db: Session, settings: Settings, role: str, actor_id: int) -> str:
    raw = secrets.token_urlsafe(32)
    db.add(AuthSession(
        token_hash=token_digest(raw, settings.session_secret),
        role=role,
        actor_id=actor_id,
        expires_at=datetime.utcnow() + timedelta(hours=settings.session_hours),
    ))
    db.commit()
    return raw


@dataclass(frozen=True)
class Principal:
    role: str
    actor_id: int
    name: str


def current_principal(
    token: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Principal:
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="请先登录")
    digest = token_digest(token, settings.session_secret)
    auth_session = db.get(AuthSession, digest)
    if not auth_session or auth_session.expires_at <= datetime.utcnow():
        if auth_session:
            db.delete(auth_session)
            db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="登录已过期")
    if auth_session.role == "admin":
        actor = db.get(Admin, auth_session.actor_id)
    else:
        actor = db.get(ChildProfile, auth_session.actor_id)
        if actor and not actor.active:
            actor = None
    if not actor:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不可用")
    return Principal(auth_session.role, actor.id, actor.username if auth_session.role == "admin" else actor.name)


def require_admin(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="需要管理员权限")
    return principal


def require_child(principal: Principal = Depends(current_principal)) -> Principal:
    if principal.role != "child":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="请使用孩子档案登录")
    return principal


class LoginLimiter:
    def __init__(self, max_attempts: int = 8, window_seconds: int = 300):
        self.max_attempts = max_attempts
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        recent = [item for item in self._attempts.get(key, []) if now - item < self.window_seconds]
        if len(recent) >= self.max_attempts:
            raise HTTPException(status_code=429, detail="尝试次数过多，请稍后再试")
        recent.append(now)
        self._attempts[key] = recent

    def clear(self, key: str) -> None:
        self._attempts.pop(key, None)


login_limiter = LoginLimiter()
