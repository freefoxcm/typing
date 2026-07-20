from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import AttemptError, Lesson, PracticeAttempt, Prompt, Word
from ..schemas import AttemptCreate, WordAttemptCreate
from ..security import Principal, require_child

router = APIRouter(prefix="/api/practice", tags=["practice"])


@router.post("/attempts")
def save_attempt(payload: AttemptCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    prompt = db.get(Prompt, payload.prompt_id)
    if not prompt or not prompt.active:
        raise HTTPException(status_code=404, detail="练习内容不存在")
    lesson = db.get(Lesson, prompt.lesson_id)
    if not lesson or not lesson.active or not lesson.course.active:
        raise HTTPException(status_code=404, detail="关卡不可用")
    char_count = len(prompt.content)
    error_count = sum(item.count for item in payload.errors)
    cpm = round(char_count * 60_000 / payload.duration_ms)
    accuracy = round(char_count / max(1, char_count + error_count) * 100, 2)
    attempt = PracticeAttempt(
        child_id=principal.actor_id,
        course_id=lesson.course_id,
        lesson_id=lesson.id,
        prompt_id=prompt.id,
        prompt_snapshot=prompt.content,
        duration_ms=payload.duration_ms,
        char_count=char_count,
        error_count=error_count,
        cpm=cpm,
        accuracy=accuracy,
    )
    attempt.errors = [AttemptError(
        expected_char=item.expected_char,
        actual_char=item.actual_char,
        count=item.count,
    ) for item in payload.errors]
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return {"id": attempt.id, "cpm": cpm, "accuracy": accuracy, "errors": error_count, "duration_ms": payload.duration_ms}


@router.post("/word-attempts")
def save_word_attempt(payload: WordAttemptCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    word = db.get(Word, payload.word_id)
    if not word or not word.active or word.enrichment_status != "ready" or not word.word_set.active:
        raise HTTPException(status_code=404, detail="单词不可用")
    char_count = len(word.spelling)
    error_count = sum(item.count for item in payload.errors)
    cpm = round(char_count * 60_000 / payload.duration_ms)
    accuracy = round(char_count / max(1, char_count + error_count) * 100, 2)
    attempt = PracticeAttempt(
        child_id=principal.actor_id,
        word_set_id=word.word_set_id,
        word_id=word.id,
        prompt_snapshot=word.spelling,
        duration_ms=payload.duration_ms,
        char_count=char_count,
        error_count=error_count,
        cpm=cpm,
        accuracy=accuracy,
    )
    attempt.errors = [AttemptError(
        expected_char=item.expected_char,
        actual_char=item.actual_char,
        count=item.count,
    ) for item in payload.errors]
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return {"id": attempt.id, "cpm": cpm, "accuracy": accuracy, "errors": error_count, "duration_ms": payload.duration_ms}

