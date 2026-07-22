import csv
import io
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..database import get_db
from ..imports import parse_import
from ..models import AttemptError, AuthSession, ChildProfile, Course, ExerciseSession, Lesson, PracticeAttempt, Prompt, WrongQuestion
from ..schemas import ChildCreate, ChildUpdate, CourseOrder, CourseWrite, ImportRequest, LessonWrite, PromptWrite
from ..security import Principal, hash_secret, require_admin

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _commit(db: Session, duplicate_message: str = "名称已存在") -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=duplicate_message) from exc


@router.get("/children")
def list_children(db: Session = Depends(get_db)):
    attempts = dict(db.execute(
        select(PracticeAttempt.child_id, func.count(PracticeAttempt.id)).group_by(PracticeAttempt.child_id)
    ).all())
    children = db.scalars(select(ChildProfile).order_by(ChildProfile.name)).all()
    return [{"id": child.id, "name": child.name, "active": child.active, "created_at": child.created_at, "attempts": attempts.get(child.id, 0)} for child in children]


@router.post("/children", status_code=201)
def create_child(payload: ChildCreate, db: Session = Depends(get_db)):
    child = ChildProfile(name=payload.name.strip(), pin_hash=hash_secret(payload.pin), active=payload.active)
    db.add(child)
    _commit(db, "孩子昵称已存在")
    db.refresh(child)
    return {"id": child.id, "name": child.name, "active": child.active}


@router.patch("/children/{child_id}")
def update_child(child_id: int, payload: ChildUpdate, db: Session = Depends(get_db)):
    child = db.get(ChildProfile, child_id)
    if not child:
        raise HTTPException(status_code=404, detail="孩子档案不存在")
    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        child.name = values["name"].strip()
    if values.get("pin"):
        child.pin_hash = hash_secret(values["pin"])
        db.execute(delete(AuthSession).where(AuthSession.role == "child", AuthSession.actor_id == child.id))
    if "active" in values:
        child.active = values["active"]
        if not child.active:
            db.execute(delete(AuthSession).where(AuthSession.role == "child", AuthSession.actor_id == child.id))
    _commit(db, "孩子昵称已存在")
    return {"id": child.id, "name": child.name, "active": child.active}


@router.delete("/children/{child_id}", status_code=204)
def delete_child(child_id: int, db: Session = Depends(get_db)):
    child = db.get(ChildProfile, child_id)
    if not child:
        raise HTTPException(status_code=404, detail="孩子档案不存在")
    db.delete(child)
    db.commit()


@router.get("/library")
def admin_library(db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course).options(selectinload(Course.lessons).selectinload(Lesson.prompts)).order_by(Course.sort_order, Course.id)
    ).all()
    return [_course_dict(course) for course in courses]


def _course_dict(course: Course) -> dict:
    return {
        "id": course.id,
        "title": course.title,
        "description": course.description,
        "sort_order": course.sort_order,
        "active": course.active,
        "lessons": [{
            "id": lesson.id,
            "course_id": lesson.course_id,
            "title": lesson.title,
            "description": lesson.description,
            "sort_order": lesson.sort_order,
            "active": lesson.active,
            "prompts": [{
                "id": prompt.id,
                "lesson_id": prompt.lesson_id,
                "content": prompt.content,
                "sort_order": prompt.sort_order,
                "active": prompt.active,
            } for prompt in lesson.prompts],
        } for lesson in course.lessons],
    }


@router.post("/courses", status_code=201)
def create_course(payload: CourseWrite, db: Session = Depends(get_db)):
    item = Course(**payload.model_dump())
    item.title = item.title.strip()
    db.add(item)
    _commit(db, "课程名称已存在")
    db.refresh(item)
    return _course_dict(item)


@router.put("/courses/order")
def reorder_courses(payload: CourseOrder, db: Session = Depends(get_db)):
    courses = db.scalars(select(Course)).all()
    courses_by_id = {course.id: course for course in courses}
    if set(payload.course_ids) != set(courses_by_id):
        raise HTTPException(status_code=409, detail="课程列表已变化，请刷新后重试")
    for sort_order, course_id in enumerate(payload.course_ids):
        courses_by_id[course_id].sort_order = sort_order
    db.commit()
    return {"ok": True, "course_ids": payload.course_ids}


@router.put("/courses/{item_id}")
def update_course(item_id: int, payload: CourseWrite, db: Session = Depends(get_db)):
    item = db.get(Course, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="课程不存在")
    for key, value in payload.model_dump().items():
        setattr(item, key, value.strip() if key == "title" else value)
    _commit(db, "课程名称已存在")
    return {"id": item.id, **payload.model_dump()}


@router.delete("/courses/{item_id}", status_code=204)
def delete_course(item_id: int, db: Session = Depends(get_db)):
    item = db.get(Course, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="课程不存在")
    db.delete(item)
    db.commit()


@router.post("/lessons", status_code=201)
def create_lesson(payload: LessonWrite, db: Session = Depends(get_db)):
    if not db.get(Course, payload.course_id):
        raise HTTPException(status_code=404, detail="课程不存在")
    item = Lesson(**payload.model_dump())
    item.title = item.title.strip()
    db.add(item)
    _commit(db, "同一课程中关卡名称不能重复")
    db.refresh(item)
    return {"id": item.id, **payload.model_dump()}


@router.put("/lessons/{item_id}")
def update_lesson(item_id: int, payload: LessonWrite, db: Session = Depends(get_db)):
    item = db.get(Lesson, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="关卡不存在")
    if not db.get(Course, payload.course_id):
        raise HTTPException(status_code=404, detail="课程不存在")
    for key, value in payload.model_dump().items():
        setattr(item, key, value.strip() if key == "title" else value)
    _commit(db, "同一课程中关卡名称不能重复")
    return {"id": item.id, **payload.model_dump()}


@router.delete("/lessons/{item_id}", status_code=204)
def delete_lesson(item_id: int, db: Session = Depends(get_db)):
    item = db.get(Lesson, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="关卡不存在")
    db.delete(item)
    db.commit()


@router.post("/prompts", status_code=201)
def create_prompt(payload: PromptWrite, db: Session = Depends(get_db)):
    if not db.get(Lesson, payload.lesson_id):
        raise HTTPException(status_code=404, detail="关卡不存在")
    item = Prompt(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, **payload.model_dump()}


@router.put("/prompts/{item_id}")
def update_prompt(item_id: int, payload: PromptWrite, db: Session = Depends(get_db)):
    item = db.get(Prompt, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="练习内容不存在")
    if not db.get(Lesson, payload.lesson_id):
        raise HTTPException(status_code=404, detail="关卡不存在")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    db.commit()
    return {"id": item.id, **payload.model_dump()}


@router.delete("/prompts/{item_id}", status_code=204)
def delete_prompt(item_id: int, db: Session = Depends(get_db)):
    item = db.get(Prompt, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="练习内容不存在")
    db.delete(item)
    db.commit()


def _target_lesson(payload: ImportRequest, db: Session) -> Lesson | None:
    if payload.format == "txt":
        if not payload.target_lesson_id:
            raise HTTPException(status_code=422, detail="TXT 导入必须选择目标关卡")
        lesson = db.get(Lesson, payload.target_lesson_id)
        if not lesson:
            raise HTTPException(status_code=404, detail="目标关卡不存在")
        return lesson
    return None


@router.post("/import/preview")
def import_preview(payload: ImportRequest, db: Session = Depends(get_db)):
    lesson = _target_lesson(payload, db)
    result = parse_import(payload.format, payload.content, lesson.title if lesson else "")
    return result.summary()


@router.post("/import")
def commit_import(payload: ImportRequest, db: Session = Depends(get_db)):
    lesson = _target_lesson(payload, db)
    result = parse_import(payload.format, payload.content, lesson.title if lesson else "")
    if result.errors:
        raise HTTPException(status_code=422, detail={"message": "导入内容有误", **result.summary()})
    try:
        if payload.format == "txt":
            if payload.mode == "replace":
                db.execute(delete(Prompt).where(Prompt.lesson_id == lesson.id))
            base_order = db.scalar(select(func.max(Prompt.sort_order)).where(Prompt.lesson_id == lesson.id)) or 0
            for index, item in enumerate(result.items, start=1):
                db.add(Prompt(lesson_id=lesson.id, content=item.prompt, sort_order=base_order + index, active=item.enabled))
        else:
            if payload.mode == "replace":
                db.execute(delete(Course))
                db.flush()
            course_cache: dict[str, Course] = {}
            lesson_cache: dict[tuple[str, str], Lesson] = {}
            for item in result.items:
                course = course_cache.get(item.course) or db.scalar(select(Course).where(Course.title == item.course))
                if not course:
                    course = Course(title=item.course, sort_order=len(course_cache))
                    db.add(course)
                    db.flush()
                course_cache[item.course] = course
                key = (item.course, item.lesson)
                lesson_item = lesson_cache.get(key) or db.scalar(select(Lesson).where(Lesson.course_id == course.id, Lesson.title == item.lesson))
                if not lesson_item:
                    lesson_item = Lesson(course_id=course.id, title=item.lesson, sort_order=len(lesson_cache))
                    db.add(lesson_item)
                    db.flush()
                lesson_cache[key] = lesson_item
                db.add(Prompt(lesson_id=lesson_item.id, content=item.prompt, sort_order=item.order, active=item.enabled))
        db.commit()
    except Exception:
        db.rollback()
        raise
    return {"ok": True, **result.summary()}


@router.get("/export")
def export_library(db: Session = Depends(get_db)):
    courses = db.scalars(
        select(Course).options(selectinload(Course.lessons).selectinload(Lesson.prompts)).order_by(Course.sort_order, Course.id)
    ).all()
    payload = {"version": 1, "exported_at": datetime.utcnow().isoformat() + "Z", "courses": [_course_dict(course) for course in courses]}
    return JSONResponse(payload, headers={"Content-Disposition": "attachment; filename=kidtype-library.json"})


def _report_query(db: Session, child_id: int | None, days: int, mode: str = "all"):
    since = datetime.utcnow() - timedelta(days=days)
    query = select(PracticeAttempt).where(PracticeAttempt.created_at >= since)
    if child_id:
        query = query.where(PracticeAttempt.child_id == child_id)
    if mode == "course":
        query = query.where(PracticeAttempt.word_id.is_(None))
    elif mode == "word":
        query = query.where(PracticeAttempt.word_id.is_not(None))
    return db.scalars(query.options(selectinload(PracticeAttempt.errors)).order_by(PracticeAttempt.created_at.desc())).all()


def _report_overview_rows(db: Session, days: int) -> list[dict]:
    since = datetime.utcnow() - timedelta(days=days)
    children = db.scalars(select(ChildProfile).order_by(ChildProfile.name, ChildProfile.id)).all()
    attempts = db.scalars(select(PracticeAttempt).where(PracticeAttempt.created_at >= since)).all()
    sessions = db.scalars(select(ExerciseSession).where(ExerciseSession.created_at >= since)).all()
    wrong_counts = dict(db.execute(
        select(WrongQuestion.child_id, func.count(WrongQuestion.id))
        .where(WrongQuestion.mastered.is_(False))
        .group_by(WrongQuestion.child_id)
    ).all())
    attempts_by_child: defaultdict[int, list[PracticeAttempt]] = defaultdict(list)
    sessions_by_child: defaultdict[int, list[ExerciseSession]] = defaultdict(list)
    for item in attempts:
        attempts_by_child[item.child_id].append(item)
    for item in sessions:
        sessions_by_child[item.child_id].append(item)
    rows: list[dict] = []
    for child in children:
        child_attempts = attempts_by_child[child.id]
        child_sessions = sessions_by_child[child.id]
        completed = [item for item in child_sessions if item.status == "completed"]
        total_chars = sum(item.char_count for item in child_attempts)
        total_errors = sum(item.error_count for item in child_attempts)
        rows.append({
            "child_id": child.id,
            "child_name": child.name,
            "active": child.active,
            "course_attempt_count": sum(item.word_id is None for item in child_attempts),
            "word_attempt_count": sum(item.word_id is not None for item in child_attempts),
            "practice_minutes": round(sum(item.duration_ms for item in child_attempts) / 60000, 1),
            "average_cpm": round(sum(item.cpm for item in child_attempts) / len(child_attempts)) if child_attempts else 0,
            "accuracy": round(total_chars / max(1, total_chars + total_errors) * 100, 2),
            "exercise_total": len(child_sessions),
            "exercise_completed": len(completed),
            "exercise_completion_rate": round(len(completed) / len(child_sessions) * 100, 1) if child_sessions else 0,
            "exercise_average_percent": round(sum(item.score / item.max_score * 100 if item.max_score else 0 for item in completed) / len(completed), 1) if completed else 0,
            "unresolved_wrong_count": wrong_counts.get(child.id, 0),
        })
    return rows


@router.get("/reports/overview")
def report_overview(days: int = Query(default=30, ge=1, le=3650), db: Session = Depends(get_db)):
    return {"days": days, "students": _report_overview_rows(db, days)}


@router.get("/reports/summary")
def report_summary(child_id: int | None = None, days: int = Query(default=30, ge=1, le=3650), mode: str = Query(default="all", pattern=r"^(all|course|word)$"), db: Session = Depends(get_db)):
    attempts = _report_query(db, child_id, days, mode)
    weak: defaultdict[str, int] = defaultdict(int)
    for attempt in attempts:
        for error in attempt.errors:
            weak[error.expected_char] += error.count
    total_chars = sum(item.char_count for item in attempts)
    total_errors = sum(item.error_count for item in attempts)
    return {
        "attempt_count": len(attempts),
        "practice_minutes": round(sum(item.duration_ms for item in attempts) / 60000, 1),
        "average_cpm": round(sum(item.cpm for item in attempts) / len(attempts)) if attempts else 0,
        "accuracy": round(total_chars / max(1, total_chars + total_errors) * 100, 2),
        "weak_keys": [{"char": char, "count": count} for char, count in sorted(weak.items(), key=lambda pair: pair[1], reverse=True)[:12]],
        "attempts": [{
            "id": item.id,
            "child_id": item.child_id,
            "lesson_id": item.lesson_id,
            "word_set_id": item.word_set_id,
            "word_id": item.word_id,
            "mode": "word" if item.word_id else "course",
            "cpm": item.cpm,
            "accuracy": item.accuracy,
            "errors": item.error_count,
            "duration_ms": item.duration_ms,
            "created_at": item.created_at,
        } for item in attempts[:100]],
    }


@router.get("/reports/export.csv")
def export_report(
    child_id: int | None = None,
    days: int = Query(default=30, ge=1, le=3650),
    mode: str = Query(default="all", pattern=r"^(all|course|word)$"),
    view: str | None = Query(default=None, pattern=r"^(overview|course|word|exercise)$"),
    db: Session = Depends(get_db),
):
    output = io.StringIO()
    writer = csv.writer(output)
    if view == "overview":
        writer.writerow(["child_id", "child_name", "course_attempts", "word_attempts", "practice_minutes", "average_cpm", "accuracy", "exercise_completed", "exercise_total", "exercise_completion_rate", "exercise_average_percent", "unresolved_wrong_count"])
        for item in _report_overview_rows(db, days):
            writer.writerow([item["child_id"], item["child_name"], item["course_attempt_count"], item["word_attempt_count"], item["practice_minutes"], item["average_cpm"], item["accuracy"], item["exercise_completed"], item["exercise_total"], item["exercise_completion_rate"], item["exercise_average_percent"], item["unresolved_wrong_count"]])
    elif view == "exercise":
        since = datetime.utcnow() - timedelta(days=days)
        query = select(ExerciseSession).where(ExerciseSession.created_at >= since)
        if child_id:
            query = query.where(ExerciseSession.child_id == child_id)
        sessions = db.scalars(query.order_by(ExerciseSession.created_at.desc())).all()
        writer.writerow(["session_id", "child_id", "mode", "status", "title", "score", "max_score", "score_percent", "created_at", "completed_at"])
        for item in sessions:
            percent = round(item.score / item.max_score * 100, 1) if item.status == "completed" and item.max_score else ""
            writer.writerow([item.id, item.child_id, item.mode, item.status, item.title, item.score, item.max_score, percent, item.created_at.isoformat(), item.completed_at.isoformat() if item.completed_at else ""])
    else:
        selected_mode = view if view in {"course", "word"} else mode
        attempts = _report_query(db, child_id, days, selected_mode)
        writer.writerow(["attempt_id", "child_id", "mode", "course_id", "lesson_id", "word_set_id", "word_id", "created_at", "duration_ms", "characters", "errors", "cpm", "accuracy"])
        for item in attempts:
            writer.writerow([item.id, item.child_id, "word" if item.word_id else "course", item.course_id, item.lesson_id, item.word_set_id, item.word_id, item.created_at.isoformat(), item.duration_ms, item.char_count, item.error_count, item.cpm, item.accuracy])
    data = output.getvalue().encode("utf-8-sig")
    return StreamingResponse(iter([data]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=kidtype-report.csv"})

