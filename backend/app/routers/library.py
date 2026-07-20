from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Course, Lesson, PracticeAttempt, Prompt, Word, WordSet
from ..security import Principal, require_child

router = APIRouter(prefix="/api/library", tags=["library"])


@router.get("/courses")
def list_courses(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course)
        .where(Course.active.is_(True))
        .options(selectinload(Course.lessons).selectinload(Lesson.prompts))
        .order_by(Course.sort_order, Course.id)
    ).all()
    best_rows = db.execute(
        select(PracticeAttempt.lesson_id, func.max(PracticeAttempt.cpm), func.max(PracticeAttempt.accuracy), func.count(PracticeAttempt.id))
        .where(PracticeAttempt.child_id == principal.actor_id)
        .group_by(PracticeAttempt.lesson_id)
    ).all()
    best = {row[0]: {"best_cpm": row[1], "best_accuracy": row[2], "attempts": row[3]} for row in best_rows}
    return [{
        "id": course.id,
        "title": course.title,
        "description": course.description,
        "lessons": [{
            "id": lesson.id,
            "title": lesson.title,
            "description": lesson.description,
            "prompt_count": sum(1 for prompt in lesson.prompts if prompt.active),
            **best.get(lesson.id, {"best_cpm": None, "best_accuracy": None, "attempts": 0}),
        } for lesson in course.lessons if lesson.active and any(prompt.active for prompt in lesson.prompts)],
    } for course in courses if any(lesson.active and any(prompt.active for prompt in lesson.prompts) for lesson in course.lessons)]


@router.get("/lessons/{lesson_id}")
def lesson_detail(lesson_id: int, _principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    lesson = db.scalar(
        select(Lesson)
        .where(Lesson.id == lesson_id, Lesson.active.is_(True))
        .options(selectinload(Lesson.prompts), selectinload(Lesson.course))
    )
    if not lesson or not lesson.course.active:
        raise HTTPException(status_code=404, detail="关卡不存在")
    prompts = [prompt for prompt in lesson.prompts if prompt.active]
    if not prompts:
        raise HTTPException(status_code=404, detail="关卡暂无练习内容")
    return {
        "id": lesson.id,
        "title": lesson.title,
        "description": lesson.description,
        "course": {"id": lesson.course.id, "title": lesson.course.title},
        "prompts": [{"id": prompt.id, "content": prompt.content} for prompt in prompts],
    }


@router.get("/word-sets")
def list_word_sets(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    items = db.scalars(
        select(WordSet)
        .where(WordSet.active.is_(True))
        .options(selectinload(WordSet.words))
        .order_by(WordSet.sort_order, WordSet.id)
    ).all()
    best_rows = db.execute(
        select(PracticeAttempt.word_set_id, func.max(PracticeAttempt.cpm), func.max(PracticeAttempt.accuracy), func.count(PracticeAttempt.id))
        .where(PracticeAttempt.child_id == principal.actor_id, PracticeAttempt.word_set_id.is_not(None))
        .group_by(PracticeAttempt.word_set_id)
    ).all()
    best = {row[0]: {"best_cpm": row[1], "best_accuracy": row[2], "attempts": row[3]} for row in best_rows}
    result = []
    for item in items:
        ready_count = sum(word.active and word.enrichment_status == "ready" for word in item.words)
        if ready_count:
            result.append({
                "id": item.id,
                "title": item.title,
                "description": item.description,
                "word_count": ready_count,
                **best.get(item.id, {"best_cpm": None, "best_accuracy": None, "attempts": 0}),
            })
    return result


@router.get("/word-sets/{word_set_id}")
def word_set_detail(word_set_id: int, _principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    item = db.scalar(
        select(WordSet)
        .where(WordSet.id == word_set_id, WordSet.active.is_(True))
        .options(selectinload(WordSet.words))
    )
    if not item:
        raise HTTPException(status_code=404, detail="单词集不存在")
    words = [word for word in item.words if word.active and word.enrichment_status == "ready"]
    if not words:
        raise HTTPException(status_code=404, detail="单词集暂无可练习内容")
    return {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "words": [{
            "id": word.id,
            "spelling": word.spelling,
            "phonetic": word.phonetic,
            "meaning_zh": word.meaning_zh,
            "technical_meaning_zh": word.technical_meaning_zh,
        } for word in words],
    }


@router.get("/recent")
def recent_attempts(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    attempts = db.scalars(
        select(PracticeAttempt)
        .where(PracticeAttempt.child_id == principal.actor_id)
        .order_by(PracticeAttempt.created_at.desc())
        .limit(10)
    ).all()
    return [{
        "id": item.id,
        "lesson_id": item.lesson_id,
        "word_set_id": item.word_set_id,
        "mode": "word" if item.word_id else "course",
        "cpm": item.cpm,
        "accuracy": item.accuracy,
        "errors": item.error_count,
        "created_at": item.created_at,
    } for item in attempts]

