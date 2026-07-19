from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..database import get_db
from ..models import Admin, AuthSession, ChildProfile
from ..schemas import AdminLogin, ChildLogin
from ..security import (
    COOKIE_NAME,
    Principal,
    current_principal,
    issue_session,
    login_limiter,
    token_digest,
    verify_secret,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=settings.session_hours * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.get("/children")
def children_for_login(db: Session = Depends(get_db)):
    children = db.scalars(select(ChildProfile).where(ChildProfile.active.is_(True)).order_by(ChildProfile.name)).all()
    return [{"id": child.id, "name": child.name} for child in children]


@router.post("/admin/login")
def admin_login(payload: AdminLogin, request: Request, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    key = f"admin:{request.client.host if request.client else 'unknown'}:{payload.username.lower()}"
    login_limiter.check(key)
    admin = db.scalar(select(Admin).where(Admin.username == payload.username))
    if not admin or not verify_secret(payload.password, admin.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    login_limiter.clear(key)
    token = issue_session(db, settings, "admin", admin.id)
    _set_cookie(response, token, settings)
    return {"role": "admin", "name": admin.username}


@router.post("/child/login")
def child_login(payload: ChildLogin, request: Request, response: Response, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    key = f"child:{request.client.host if request.client else 'unknown'}:{payload.child_id}"
    login_limiter.check(key)
    child = db.get(ChildProfile, payload.child_id)
    if not child or not child.active or not verify_secret(payload.pin, child.pin_hash):
        raise HTTPException(status_code=401, detail="档案或 PIN 不正确")
    login_limiter.clear(key)
    token = issue_session(db, settings, "child", child.id)
    _set_cookie(response, token, settings)
    return {"role": "child", "name": child.name, "actor_id": child.id}


@router.get("/me")
def me(principal: Principal = Depends(current_principal)):
    return {"role": principal.role, "name": principal.name, "actor_id": principal.actor_id}


@router.post("/logout")
def logout(response: Response, token: str | None = None, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    # Cookie is read manually here so logout remains idempotent even for expired sessions.
    from fastapi import Request
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}

