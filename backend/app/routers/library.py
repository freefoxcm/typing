from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..models import Course, Lesson, PracticeAttempt, Prompt
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
        "cpm": item.cpm,
        "accuracy": item.accuracy,
        "errors": item.error_count,
        "created_at": item.created_at,
    } for item in attempts]

