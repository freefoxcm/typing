import hashlib
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AttemptError, Lesson, PracticeAttempt, Prompt, Word
from ..schemas import AttemptCreate, WordAttemptCreate
from ..security import Principal, require_child
from ..typing_stats import CURRENT_METRIC_VERSION, LEGACY_METRIC_VERSION, calculate_cpm

router = APIRouter(prefix="/api/practice", tags=["practice"])


def _fingerprint(payload: AttemptCreate | WordAttemptCreate) -> str:
    data = json.dumps(payload.model_dump(exclude={"request_id"}), sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(data.encode()).hexdigest()


def _replayed_attempt(db: Session, child_id: int, payload: AttemptCreate | WordAttemptCreate):
    if not payload.request_id:
        return None
    previous = db.scalar(select(PracticeAttempt).where(
        PracticeAttempt.child_id == child_id, PracticeAttempt.request_id == payload.request_id,
    ))
    if previous and previous.request_fingerprint != _fingerprint(payload):
        raise HTTPException(status_code=409, detail="这次成绩的重试标识已用于其他内容，请重新开始练习")
    return _attempt_result(previous) if previous else None


def _commit_attempt(db: Session, attempt: PracticeAttempt, payload: AttemptCreate | WordAttemptCreate):
    attempt.request_id = payload.request_id
    attempt.request_fingerprint = _fingerprint(payload) if payload.request_id else None
    child_id = attempt.child_id
    db.add(attempt)
    try:
        db.commit()
    except IntegrityError:
        # The unique index also handles simultaneous retries, including lost responses.
        db.rollback()
        previous = _replayed_attempt(db, child_id, payload)
        if previous is not None:
            return previous
        raise
    db.refresh(attempt)
    return _attempt_result(attempt)


def _speed_fields(requested: int | None, char_count: int, duration_ms: int) -> tuple[int, int, int | None]:
    if requested is None:
        speed_char_count = char_count
        metric_version = LEGACY_METRIC_VERSION
    else:
        if requested not in {char_count, char_count - 1}:
            raise HTTPException(status_code=422, detail="测速字符数必须等于完整字符数或少 1")
        speed_char_count = requested
        metric_version = CURRENT_METRIC_VERSION
    return speed_char_count, metric_version, calculate_cpm(speed_char_count, duration_ms)


def _attempt_result(attempt: PracticeAttempt) -> dict:
    return {
        "id": attempt.id,
        "cpm": attempt.cpm,
        "accuracy": attempt.accuracy,
        "errors": attempt.error_count,
        "duration_ms": attempt.duration_ms,
        "speed_char_count": attempt.speed_char_count,
        "metric_version": attempt.metric_version,
    }


@router.post("/attempts")
def save_attempt(payload: AttemptCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    previous = _replayed_attempt(db, principal.actor_id, payload)
    if previous is not None:
        return previous
    prompt = db.get(Prompt, payload.prompt_id)
    if not prompt or not prompt.active:
        raise HTTPException(status_code=404, detail="练习内容不存在")
    lesson = db.get(Lesson, prompt.lesson_id)
    if not lesson or not lesson.active or not lesson.course.active:
        raise HTTPException(status_code=404, detail="关卡不可用")
    char_count = len(prompt.content)
    error_count = sum(item.count for item in payload.errors)
    speed_char_count, metric_version, cpm = _speed_fields(payload.speed_char_count, char_count, payload.duration_ms)
    accuracy = round(char_count / max(1, char_count + error_count) * 100, 2)
    attempt = PracticeAttempt(
        child_id=principal.actor_id,
        course_id=lesson.course_id,
        lesson_id=lesson.id,
        prompt_id=prompt.id,
        prompt_snapshot=prompt.content,
        duration_ms=payload.duration_ms,
        char_count=char_count,
        speed_char_count=speed_char_count,
        metric_version=metric_version,
        error_count=error_count,
        cpm=cpm,
        accuracy=accuracy,
    )
    attempt.errors = [AttemptError(
        expected_char=item.expected_char,
        actual_char=item.actual_char,
        count=item.count,
    ) for item in payload.errors]
    return _commit_attempt(db, attempt, payload)


@router.post("/word-attempts")
def save_word_attempt(payload: WordAttemptCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    previous = _replayed_attempt(db, principal.actor_id, payload)
    if previous is not None:
        return previous
    word = db.get(Word, payload.word_id)
    if not word or not word.active or word.enrichment_status != "ready" or not word.word_set.active:
        raise HTTPException(status_code=404, detail="单词不可用")
    char_count = len(word.spelling)
    error_count = sum(item.count for item in payload.errors)
    speed_char_count, metric_version, cpm = _speed_fields(payload.speed_char_count, char_count, payload.duration_ms)
    accuracy = round(char_count / max(1, char_count + error_count) * 100, 2)
    attempt = PracticeAttempt(
        child_id=principal.actor_id,
        word_set_id=word.word_set_id,
        word_id=word.id,
        prompt_snapshot=word.spelling,
        duration_ms=payload.duration_ms,
        char_count=char_count,
        speed_char_count=speed_char_count,
        metric_version=metric_version,
        error_count=error_count,
        cpm=cpm,
        accuracy=accuracy,
    )
    attempt.errors = [AttemptError(
        expected_char=item.expected_char,
        actual_char=item.actual_char,
        count=item.count,
    ) for item in payload.errors]
    return _commit_attempt(db, attempt, payload)

