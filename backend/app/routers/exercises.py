import json
import random
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import Settings, get_settings
from ..database import get_db
from ..exercise_library import loads_json, question_set_dict, question_snapshot
from ..exercise_schemas import AnswerWrite, SampleRunCreate, SessionCreate
from ..judge_queue import enqueue, result as judge_result
from ..models import (
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    ProgrammingSpec,
    Question,
    QuestionSet,
    WrongQuestion,
)
from ..security import Principal, require_child


router = APIRouter(prefix="/api/exercises", tags=["exercises"])


def _published_sets_query():
    return select(QuestionSet).where(QuestionSet.status == "published").options(
        selectinload(QuestionSet.questions).selectinload(Question.options),
        selectinload(QuestionSet.questions).selectinload(Question.programming).selectinload(ProgrammingSpec.cases),
    )


def _owned_session(db: Session, session_id: int, child_id: int) -> ExerciseSession:
    item = db.scalar(
        select(ExerciseSession)
        .where(ExerciseSession.id == session_id, ExerciseSession.child_id == child_id)
        .options(selectinload(ExerciseSession.items).selectinload(ExerciseSessionItem.answer))
    )
    if not item:
        raise HTTPException(status_code=404, detail="练习不存在")
    return item


def _public_snapshot(snapshot: dict[str, Any], reveal: bool) -> dict[str, Any]:
    data = json.loads(json.dumps(snapshot, ensure_ascii=False))
    program = data.get("programming")
    if not reveal:
        data.pop("correct_bool", None)
        data["explanation_markdown"] = ""
        for option in data.get("options", []):
            option.pop("correct", None)
        if program:
            program["reference_solution"] = ""
            program["cases"] = [case for case in program.get("cases", []) if case.get("is_sample")]
            for case in program["cases"]:
                case.pop("confirmed", None)
                case.pop("weight", None)
    elif program:
        for case in program.get("cases", []):
            if not case.get("is_sample"):
                case.pop("input_data", None)
                case.pop("expected_output", None)
                case.pop("note", None)
                case.pop("confirmed", None)
    return data


def _answer_dict(answer: ExerciseAnswer | None, reveal: bool) -> dict[str, Any]:
    if not answer:
        return {"selected_option_ids": [], "bool_answer": None, "code": "", "status": "unanswered"}
    values = loads_json(answer.answer_json, {})
    result = {
        "selected_option_ids": values.get("selected_option_ids", []),
        "bool_answer": values.get("bool_answer"),
        "code": answer.code,
        "status": answer.status,
    }
    if reveal:
        details = loads_json(answer.details_json, {})
        details.pop("job_id", None)
        result.update({"awarded_points": answer.awarded_points, "details": details})
    return result


def _session_dict(session: ExerciseSession) -> dict[str, Any]:
    reveal = session.status == "completed"
    return {
        "id": session.id,
        "title": session.title,
        "mode": session.mode,
        "status": session.status,
        "score": session.score if reveal else None,
        "max_score": session.max_score,
        "created_at": session.created_at,
        "submitted_at": session.submitted_at,
        "completed_at": session.completed_at,
        "items": [{
            "id": item.id,
            "sort_order": item.sort_order,
            "points": item.points,
            "question": _public_snapshot(loads_json(item.snapshot_json, {}), reveal),
            "answer": _answer_dict(item.answer, reveal),
        } for item in session.items],
    }


@router.get("/question-sets")
def list_question_sets(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    sets = db.scalars(_published_sets_query().order_by(QuestionSet.published_at.desc(), QuestionSet.id.desc())).unique().all()
    rows = db.execute(
        select(ExerciseSession.config_json, func.max(ExerciseSession.score), func.max(ExerciseSession.max_score), func.count(ExerciseSession.id))
        .where(ExerciseSession.child_id == principal.actor_id, ExerciseSession.status == "completed", ExerciseSession.mode == "set")
        .group_by(ExerciseSession.config_json)
    ).all()
    stats: dict[int, dict[str, Any]] = {}
    for config_json, best_score, max_score, attempts in rows:
        config = loads_json(config_json, {})
        ids = config.get("question_set_ids", [])
        if len(ids) == 1:
            stats[int(ids[0])] = {"best_score": best_score, "best_max_score": max_score, "attempts": attempts}
    result = []
    for item in sets:
        data = question_set_dict(item, include_questions=False)
        data.update(stats.get(item.id, {"best_score": None, "best_max_score": None, "attempts": 0}))
        result.append(data)
    return result


@router.get("/wrong-questions")
def wrong_questions(principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    items = db.scalars(
        select(WrongQuestion)
        .join(Question, Question.id == WrongQuestion.question_id)
        .join(QuestionSet, QuestionSet.id == Question.question_set_id)
        .where(WrongQuestion.child_id == principal.actor_id, WrongQuestion.mastered.is_(False), QuestionSet.status == "published")
        .order_by(WrongQuestion.last_wrong_at.desc())
    ).all()
    return [{"question_id": item.question_id, "wrong_count": item.wrong_count, "last_wrong_at": item.last_wrong_at} for item in items]


def _select_questions(db: Session, child_id: int, payload: SessionCreate) -> tuple[list[Question], str]:
    if payload.mode in {"set", "random"}:
        if not payload.question_set_ids:
            raise HTTPException(status_code=422, detail="请选择至少一个题套")
        sets = db.scalars(_published_sets_query().where(QuestionSet.id.in_(payload.question_set_ids))).unique().all()
        if len(sets) != len(payload.question_set_ids):
            raise HTTPException(status_code=404, detail="部分题套不存在或未发布")
        if payload.mode == "set":
            if len(sets) != 1:
                raise HTTPException(status_code=422, detail="整套练习只能选择一个题套")
            return list(sets[0].questions), sets[0].title
        pool = [question for item in sets for question in item.questions]
        selected: list[Question] = []
        for kind, count in payload.counts.items():
            candidates = [item for item in pool if item.type == kind]
            if count > len(candidates):
                raise HTTPException(status_code=422, detail=f"{kind} 仅有 {len(candidates)} 道可用题目")
            selected.extend(random.sample(candidates, count))
        if not selected:
            raise HTTPException(status_code=422, detail="随机练习至少需要一道题")
        random.shuffle(selected)
        return selected, "随机习题练习"
    wrong_ids = db.scalars(
        select(WrongQuestion.question_id)
        .join(Question, Question.id == WrongQuestion.question_id)
        .join(QuestionSet, QuestionSet.id == Question.question_set_id)
        .where(WrongQuestion.child_id == child_id, WrongQuestion.mastered.is_(False), QuestionSet.status == "published")
    ).all()
    if not wrong_ids:
        raise HTTPException(status_code=422, detail="当前没有未掌握错题")
    questions = db.scalars(
        select(Question).where(Question.id.in_(wrong_ids)).options(
            selectinload(Question.options), selectinload(Question.programming).selectinload(ProgrammingSpec.cases), selectinload(Question.question_set)
        )
    ).unique().all()
    random.shuffle(questions)
    return list(questions), "错题重练"


@router.post("/sessions", status_code=201)
def create_session(payload: SessionCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    questions, title = _select_questions(db, principal.actor_id, payload)
    session = ExerciseSession(
        child_id=principal.actor_id,
        mode=payload.mode,
        status="in_progress",
        config_json=json.dumps(payload.model_dump(), ensure_ascii=False),
        title=title,
        max_score=sum(item.points for item in questions),
    )
    db.add(session)
    db.flush()
    for index, question in enumerate(questions):
        set_title = question.question_set.title if question.question_set else title
        session.items.append(ExerciseSessionItem(
            question_id=question.id,
            question_set_id=question.question_set_id,
            sort_order=index,
            points=question.points,
            snapshot_json=json.dumps(question_snapshot(question, set_title), ensure_ascii=False),
        ))
    db.commit()
    return _session_dict(_owned_session(db, session.id, principal.actor_id))


@router.get("/sessions/{session_id}")
def get_session(session_id: int, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    session = _owned_session(db, session_id, principal.actor_id)
    if session.status == "judging":
        _reconcile(session, db, settings)
        session = _owned_session(db, session_id, principal.actor_id)
    return _session_dict(session)


@router.patch("/sessions/{session_id}/answers/{item_id}")
def save_answer(session_id: int, item_id: int, payload: AnswerWrite, principal: Principal = Depends(require_child), db: Session = Depends(get_db)):
    session = _owned_session(db, session_id, principal.actor_id)
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="练习已提交，不能修改答案")
    item = next((candidate for candidate in session.items if candidate.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="练习题目不存在")
    snapshot = loads_json(item.snapshot_json, {})
    option_ids = {int(option["id"]) for option in snapshot.get("options", [])}
    if any(option_id not in option_ids for option_id in payload.selected_option_ids):
        raise HTTPException(status_code=422, detail="答案包含无效选项")
    answer = item.answer or ExerciseAnswer(session_item_id=item.id)
    answer.answer_json = json.dumps({"selected_option_ids": payload.selected_option_ids, "bool_answer": payload.bool_answer}, ensure_ascii=False)
    answer.code = payload.code
    answer.status = "answered" if payload.selected_option_ids or payload.bool_answer is not None or payload.code.strip() else "unanswered"
    if not item.answer:
        db.add(answer)
    db.commit()
    return {"ok": True, "status": answer.status}


@router.post("/sessions/{session_id}/sample-runs", status_code=202)
def sample_run(session_id: int, payload: SampleRunCreate, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    session = _owned_session(db, session_id, principal.actor_id)
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="已提交的练习不能运行样例")
    item = next((candidate for candidate in session.items if candidate.id == payload.session_item_id), None)
    snapshot = loads_json(item.snapshot_json, {}) if item else {}
    program = snapshot.get("programming")
    if not item or snapshot.get("type") != "programming" or not program:
        raise HTTPException(status_code=404, detail="编程题不存在")
    cases = [
        case for case in program.get("cases", [])
        if case.get("is_sample") and (
            str(case.get("input_data") or "").strip()
            or str(case.get("expected_output") or "").strip()
        )
    ]
    if not cases:
        raise HTTPException(status_code=422, detail="该题没有配置有效的公开样例输入输出，请联系管理员补充")
    job_id = enqueue(settings, {
        "kind": "sample", "session_id": session.id, "session_item_id": item.id, "code": payload.code,
        "time_limit_ms": program.get("time_limit_ms", 1000), "memory_limit_mb": program.get("memory_limit_mb", 128),
        "cases": [{"id": case.get("id"), "input": case.get("input_data", ""), "expected": case.get("expected_output", ""), "weight": 0} for case in cases],
    })
    return {"job_id": job_id, "status": "queued"}


@router.get("/sample-runs/{job_id}")
def sample_run_result(job_id: str, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    payload = judge_result(settings, job_id)
    if payload is None:
        return {"job_id": job_id, "status": "queued"}
    session_id = int(payload.get("session_id") or 0)
    if not db.scalar(select(ExerciseSession.id).where(ExerciseSession.id == session_id, ExerciseSession.child_id == principal.actor_id)):
        raise HTTPException(status_code=404, detail="运行任务不存在")
    return payload


def _score_objective(item: ExerciseSessionItem, answer: ExerciseAnswer) -> None:
    snapshot = loads_json(item.snapshot_json, {})
    values = loads_json(answer.answer_json, {})
    kind = snapshot.get("type")
    correct = False
    if kind in {"single_choice", "multiple_choice"}:
        expected = sorted(int(option["id"]) for option in snapshot.get("options", []) if option.get("correct"))
        actual = sorted(int(value) for value in values.get("selected_option_ids", []))
        correct = expected == actual
    elif kind == "true_false":
        correct = values.get("bool_answer") is not None and values.get("bool_answer") == snapshot.get("correct_bool")
    answer.status = "correct" if correct else "incorrect"
    answer.awarded_points = item.points if correct else 0
    answer.details_json = json.dumps({"correct": correct}, ensure_ascii=False)


def _update_wrong(db: Session, child_id: int, item: ExerciseSessionItem, full_credit: bool) -> None:
    if not item.question_id:
        return
    wrong = db.scalar(select(WrongQuestion).where(WrongQuestion.child_id == child_id, WrongQuestion.question_id == item.question_id))
    if full_credit:
        if wrong and not wrong.mastered:
            wrong.mastered = True
            wrong.mastered_at = datetime.utcnow()
        return
    if not wrong:
        db.add(WrongQuestion(child_id=child_id, question_id=item.question_id, wrong_count=1, mastered=False, last_wrong_at=datetime.utcnow()))
    else:
        wrong.wrong_count += 1
        wrong.mastered = False
        wrong.mastered_at = None
        wrong.last_wrong_at = datetime.utcnow()


def _finish(session: ExerciseSession, db: Session) -> None:
    session.score = sum((item.answer.awarded_points if item.answer else 0) for item in session.items)
    session.status = "completed"
    session.completed_at = datetime.utcnow()
    for item in session.items:
        _update_wrong(db, session.child_id, item, bool(item.answer and item.answer.awarded_points == item.points))
    db.commit()


@router.post("/sessions/{session_id}/submit", status_code=202)
def submit_session(session_id: int, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    session = _owned_session(db, session_id, principal.actor_id)
    if session.status in {"judging", "completed"}:
        return {"id": session.id, "status": session.status}
    if session.status != "in_progress":
        raise HTTPException(status_code=409, detail="练习状态异常")
    has_jobs = False
    for item in session.items:
        answer = item.answer
        if not answer:
            answer = ExerciseAnswer(session_item_id=item.id, status="unanswered")
            db.add(answer)
            db.flush()
            item.answer = answer
        snapshot = loads_json(item.snapshot_json, {})
        if snapshot.get("type") != "programming":
            _score_objective(item, answer)
            continue
        program = snapshot.get("programming") or {}
        hidden = [case for case in program.get("cases", []) if not case.get("is_sample") and case.get("confirmed")]
        if not answer.code.strip():
            answer.status = "unanswered"
            answer.awarded_points = 0
            answer.details_json = "{}"
            continue
        job_id = enqueue(settings, {
            "kind": "submission", "session_id": session.id, "session_item_id": item.id, "code": answer.code,
            "time_limit_ms": program.get("time_limit_ms", 1000), "memory_limit_mb": program.get("memory_limit_mb", 128),
            "cases": [{"id": case.get("id"), "input": case.get("input_data", ""), "expected": case.get("expected_output", ""), "weight": case.get("weight", 0)} for case in hidden],
        })
        answer.status = "judging"
        answer.details_json = json.dumps({"job_id": job_id}, ensure_ascii=False)
        has_jobs = True
    session.submitted_at = datetime.utcnow()
    session.status = "judging" if has_jobs else "completed"
    db.commit()
    if has_jobs:
        return {"id": session.id, "status": "judging"}
    _finish(session, db)
    return {"id": session.id, "status": "completed"}


def _reconcile(session: ExerciseSession, db: Session, settings: Settings) -> None:
    waiting = False
    for item in session.items:
        answer = item.answer
        if not answer or answer.status != "judging":
            continue
        details = loads_json(answer.details_json, {})
        payload = judge_result(settings, details.get("job_id", ""))
        if payload is None:
            waiting = True
            continue
        cases = payload.get("cases", [])
        answer.awarded_points = sum(int(case.get("weight") or 0) for case in cases if case.get("status") == "AC")
        answer.status = "AC" if answer.awarded_points == item.points else next((str(case.get("status")) for case in cases if case.get("status") != "AC"), "WA")
        answer.details_json = json.dumps({
            "cases": [{"id": case.get("id"), "status": case.get("status"), "duration_ms": case.get("duration_ms"), "weight": case.get("weight")} for case in cases],
            "passed": sum(case.get("status") == "AC" for case in cases),
            "total": len(cases),
        }, ensure_ascii=False)
    if not waiting and all(not item.answer or item.answer.status != "judging" for item in session.items):
        _finish(session, db)
    else:
        db.commit()


@router.get("/sessions/{session_id}/result")
def session_result(session_id: int, principal: Principal = Depends(require_child), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    session = _owned_session(db, session_id, principal.actor_id)
    if session.status == "judging":
        _reconcile(session, db, settings)
        session = _owned_session(db, session_id, principal.actor_id)
    return _session_dict(session)
