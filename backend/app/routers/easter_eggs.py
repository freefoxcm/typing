import base64
import hashlib
import hmac
import json
from datetime import timedelta
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .. import easter_eggs as rewards
from ..config import Settings, get_settings
from ..database import get_db
from ..models import EasterEggSettings, EasterEggReward, EasterEggPlaySession
from ..security import Principal, require_admin, require_child

router = APIRouter(prefix="/api", tags=["easter-eggs"])
ASSETS = Path(__file__).resolve().parents[2] / "game_assets"


class GameRequest(BaseModel):
    game_id: Literal["super-mario", "kart-racer"]
    instance_id: str = Field(min_length=16, max_length=64, pattern=r"^[a-zA-Z0-9-]+$")
    take_over: bool = False


class InstanceRequest(BaseModel):
    instance_id: str = Field(min_length=16, max_length=64, pattern=r"^[a-zA-Z0-9-]+$")


def owned(db, reward_id, principal):
    reward = db.get(EasterEggReward, reward_id, populate_existing=True)
    if not reward or reward.child_id != principal.actor_id:
        raise HTTPException(404, "奖励不存在")
    if not rewards.settings_for(db).enabled or not rewards.usable(reward, rewards.play_for(db, reward.id), rewards.utcnow()):
        raise HTTPException(410, "本次游戏时光已结束或彩蛋已关闭")
    return reward


def allowed(reward, game):
    if game not in json.loads(reward.games_json):
        raise HTTPException(403, "尚未解锁这个游戏")


def response(reward, play):
    return {"reward": rewards.reward_dict(reward, play), "server_now": rewards.iso(rewards.utcnow())}


@router.get("/admin/easter-egg-settings")
def read_settings(_principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return rewards.settings_for(db)


@router.put("/admin/easter-egg-settings")
def write_settings(payload: rewards.RewardSettings, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    rewards.lock_settings(db)
    db.get(EasterEggSettings, 1).config_json = payload.model_dump_json()
    if not payload.enabled:
        db.execute(update(EasterEggReward).where(EasterEggReward.status.in_(["available", "started"])).values(status="revoked"))
    db.commit()
    return payload


@router.get("/easter-eggs/reward")
def current_reward(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    now = rewards.utcnow()
    if rewards.settings_for(db).enabled:
        rows = db.scalars(select(EasterEggReward).outerjoin(EasterEggPlaySession).where(EasterEggReward.child_id == principal.actor_id,
            EasterEggReward.status.in_(["available", "started"]),
            or_(EasterEggReward.reward_date == rewards.local_day(now), EasterEggPlaySession.expires_at > now)).order_by(EasterEggReward.id.desc())).all()
        # A running reward across midnight takes precedence over today's unopened reward.
        for status in ("started", "available"):
            for reward in rows:
                play = rewards.play_for(db, reward.id)
                if reward.status == status and rewards.usable(reward, play, now):
                    return response(reward, play)
    return {"reward": None, "server_now": rewards.iso(now)}


def ticket_for(reward, payload, settings):
    body = base64.urlsafe_b64encode(json.dumps({"r": reward.id, "c": reward.child_id, "g": payload.game_id,
        "i": payload.instance_id, "until": rewards.iso(rewards.utcnow() + timedelta(minutes=2))}, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(settings.session_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


@router.post("/easter-eggs/rewards/{reward_id}/prepare")
def prepare(reward_id: int, payload: GameRequest, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    reward = owned(db, reward_id, principal)
    allowed(reward, payload.game_id)
    ticket = ticket_for(reward, payload, settings)
    return {"url": f"/api/easter-eggs/assets/{reward.id}/{ticket}/{payload.game_id}/index.html"}


@router.post("/easter-eggs/rewards/{reward_id}/start")
def start(reward_id: int, payload: GameRequest, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    rewards.lock_settings(db)
    reward = owned(db, reward_id, principal)
    allowed(reward, payload.game_id)
    now = rewards.utcnow()
    play = rewards.play_for(db, reward.id)
    other = db.scalar(select(EasterEggPlaySession).join(EasterEggReward).where(EasterEggReward.child_id == principal.actor_id,
        EasterEggReward.status == "started", EasterEggPlaySession.expires_at > now, EasterEggReward.id != reward.id))
    if other:
        raise HTTPException(409, "请先使用尚未结束的游戏时光")
    if play:
        if play.instance_id and play.instance_id != payload.instance_id and play.lease_until > now and not payload.take_over:
            raise HTTPException(409, "游戏正在另一个页面运行，可以选择在此继续")
        if play.instance_id == payload.instance_id and play.game_id != payload.game_id:
            raise HTTPException(409, "请通过切换游戏继续")
        play.instance_id = payload.instance_id
        play.game_id = payload.game_id
        play.lease_until = now + timedelta(seconds=15)
    else:
        config = rewards.RewardSettings.model_validate_json(reward.config_json)
        play = EasterEggPlaySession(reward_id=reward.id, started_at=now, expires_at=now + timedelta(minutes=config.duration_minutes),
            game_id=payload.game_id, instance_id=payload.instance_id, lease_until=now + timedelta(seconds=15))
        db.add(play)
        reward.status = "started"
    db.commit()
    return response(reward, play)


def active_play(db, session_id, instance_id, principal):
    play = db.get(EasterEggPlaySession, session_id, populate_existing=True)
    if not play:
        raise HTTPException(404, "游戏会话不存在")
    reward = owned(db, play.reward_id, principal)
    if play.instance_id != instance_id:
        raise HTTPException(409, "游戏已在其他页面继续")
    return reward, play


@router.post("/easter-eggs/sessions/{session_id}/heartbeat")
def heartbeat(session_id: int, payload: InstanceRequest, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    rewards.lock_settings(db)
    reward, play = active_play(db, session_id, payload.instance_id, principal)
    play.lease_until = rewards.utcnow() + timedelta(seconds=15)
    db.commit()
    return response(reward, play)


@router.post("/easter-eggs/sessions/{session_id}/switch")
def switch(session_id: int, payload: GameRequest, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    rewards.lock_settings(db)
    reward, play = active_play(db, session_id, payload.instance_id, principal)
    allowed(reward, payload.game_id)
    play.game_id = payload.game_id
    play.lease_until = rewards.utcnow() + timedelta(seconds=15)
    db.commit()
    return response(reward, play)


@router.post("/easter-eggs/sessions/{session_id}/leave")
def leave(session_id: int, payload: InstanceRequest, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    rewards.lock_settings(db)
    play = db.get(EasterEggPlaySession, session_id)
    reward = db.get(EasterEggReward, play.reward_id) if play else None
    if not reward or reward.child_id != principal.actor_id:
        raise HTTPException(404, "游戏会话不存在")
    if play.instance_id == payload.instance_id:
        play.instance_id = ""
        play.lease_until = rewards.utcnow()
        db.commit()
    return {"ok": True}


@router.get("/easter-eggs/assets/{reward_id}/{ticket}/{game_id}/{asset_path:path}", include_in_schema=False)
def asset(reward_id: int, ticket: str, game_id: str, asset_path: str, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    reward = owned(db, reward_id, principal)
    allowed(reward, game_id)
    try:
        body, signature = ticket.split(".")
        expected = hmac.new(settings.session_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError()
        data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if (data["r"], data["c"], data["g"]) != (reward.id, principal.actor_id, game_id):
            raise ValueError()
        play = rewards.play_for(db, reward.id)
        active = play and play.instance_id == data["i"] and play.game_id == game_id and play.lease_until > rewards.utcnow()
        if not active and data["until"] <= rewards.iso(rewards.utcnow()):
            raise ValueError()
    except (ValueError, KeyError, TypeError):
        raise HTTPException(403, "游戏加载凭据已失效，请重新打开")
    root = ASSETS / ("shared" if asset_path.startswith("_shared/") else game_id)
    relative = asset_path.removeprefix("_shared/")
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file() or path.suffix not in {".html", ".js", ".css", ".svg", ".png", ".webp", ".jpg", ".woff2", ".txt"}:
        raise HTTPException(404, "游戏资源不存在")
    headers = {"Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN", "Referrer-Policy": "no-referrer"}
    if path.name == "index.html":
        context = json.dumps({"childId": principal.actor_id, "instanceId": data["i"], "gameId": game_id})
        html = path.read_text(encoding="utf-8").replace("<!--REWARD_CONTEXT-->", f"<script>window.rewardContext={context};</script>")
        return HTMLResponse(html, headers=headers)
    return FileResponse(path, headers=headers)
