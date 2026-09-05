"""Server-owned reward policy. All timestamps are naive UTC, like existing models."""
import json
import secrets
from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Session

from .models import EasterEggSettings, EasterEggReward, EasterEggPlaySession, ExerciseSession

GAMES = ("super-mario", "kart-racer")


class RewardSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = False
    duration_minutes: int = Field(default=15, ge=1, le=60)
    mode: Literal["score", "random"] = "score"
    adventure_threshold: int = Field(default=80, ge=0, le=100)
    racer_threshold: int = Field(default=90, ge=0, le=100)
    random_threshold: int = Field(default=80, ge=0, le=100)
    minimum_questions: int = Field(default=10, ge=1, le=10000)


def utcnow():
    return datetime.utcnow()


def local_day(now: datetime):
    return (now + timedelta(hours=8)).date().isoformat()


def iso(value: datetime):
    return value.isoformat(timespec="milliseconds") + "Z"


def settings_for(db: Session) -> RewardSettings:
    row = db.get(EasterEggSettings, 1, populate_existing=True)
    return RewardSettings.model_validate_json(row.config_json) if row else RewardSettings()


def lock_settings(db: Session):
    # SQLite's writer lock serializes settings changes, starts and award decisions.
    db.execute(insert(EasterEggSettings).values(id=1, config_json=RewardSettings().model_dump_json()).on_conflict_do_nothing())


def eligible_games(session: ExerciseSession, config: RewardSettings):
    if session.mode not in {"set", "random"} or len(session.items) < config.minimum_questions or session.max_score <= 0:
        return []
    reaches = lambda threshold: session.score * 100 >= threshold * session.max_score
    if config.mode == "random":
        return [secrets.choice(GAMES)] if reaches(config.random_threshold) else []
    return [game for game, threshold in zip(GAMES, (config.adventure_threshold, config.racer_threshold)) if reaches(threshold)]


def award_completed(db: Session, session: ExerciseSession):
    """Called only in the transaction that FIRST completes a practice session."""
    lock_settings(db)
    config = settings_for(db)
    if not config.enabled:
        return
    now = utcnow()
    reward = db.scalar(select(EasterEggReward).where(EasterEggReward.child_id == session.child_id, EasterEggReward.reward_date == local_day(now)))
    if reward:
        if reward.status != "available":
            return
        config = RewardSettings.model_validate_json(reward.config_json)
        if config.mode == "random":
            return
    games = eligible_games(session, config)
    if not games:
        return
    if reward:
        merged = [game for game in GAMES if game in set(json.loads(reward.games_json) + games)]
        if merged != json.loads(reward.games_json):
            reward.games_json = json.dumps(merged)
            reward.display_version += 1
            reward.source_session_id = session.id
    else:
        db.add(EasterEggReward(child_id=session.child_id, reward_date=local_day(now), source_session_id=session.id,
            config_json=config.model_dump_json(), games_json=json.dumps(games), status="available", display_version=1, created_at=now))


def play_for(db: Session, reward_id: int):
    return db.scalar(select(EasterEggPlaySession).where(EasterEggPlaySession.reward_id == reward_id))


def usable(reward: EasterEggReward, play: EasterEggPlaySession | None, now: datetime):
    return (reward.status == "available" and reward.reward_date == local_day(now)) or (reward.status == "started" and play is not None and play.expires_at > now)


def reward_dict(reward: EasterEggReward, play: EasterEggPlaySession | None):
    config = RewardSettings.model_validate_json(reward.config_json)
    return dict(id=reward.id, child_id=reward.child_id, source_session_id=reward.source_session_id,
        reward_date=reward.reward_date, games=json.loads(reward.games_json), status=reward.status,
        display_version=reward.display_version, duration_minutes=config.duration_minutes, mode=config.mode,
        play=dict(id=play.id, game_id=play.game_id, started_at=iso(play.started_at), expires_at=iso(play.expires_at)) if play else None)
