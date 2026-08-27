import asyncio
import hashlib
import json
import logging
from copy import deepcopy
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Callable

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .exercise_library import question_dict, replace_question
from .exercise_schemas import QuestionWrite
from .models import Question, QuestionAsset, QuestionRecognitionJob, QuestionSet
from .question_imports import (
    _confidence_value,
    _crop_is_suspicious,
    _import_error_detail,
    _question_type,
    _request_focused_review,
    _safe_markdown,
    _save_crop,
    parse_pdf,
    repair_crop_regions,
)


logger = logging.getLogger("uvicorn.error")


def _loads(value: str, default: Any) -> Any:
    try:
        return json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return default


def question_fingerprint(question: Question) -> str:
    payload = question_dict(question)
    payload.pop("reviewed", None)
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str).encode()).hexdigest()


def set_fingerprint(question_set: QuestionSet) -> str:
    payload = {
        "title": question_set.title,
        "description": question_set.description,
        "source_pdf_asset_id": question_set.source_pdf_asset_id,
        "questions": [question_fingerprint(item) for item in sorted(question_set.questions, key=lambda value: (value.sort_order, value.id))],
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def target_fingerprint(question_set: QuestionSet, question: Question | None) -> str:
    return question_fingerprint(question) if question is not None else set_fingerprint(question_set)


def _raw_from_question(question: Question) -> dict[str, Any]:
    raw: dict[str, Any] = {
        "number": question.source_number,
        "section": question.source_section,
        "type": question.type,
        "stem_markdown": question.stem_markdown,
        "explanation_markdown": question.explanation_markdown,
        "points": question.points,
        "correct_bool": question.correct_bool,
        "source_page": question.source_page or 1,
        "source_end_page": question.source_end_page or question.source_page or 1,
        "complete": True,
        "has_visual": bool(question.source_asset_id),
        "options": [
            {"label": item.label, "content_markdown": item.content_markdown, "correct": item.correct}
            for item in question.options
        ],
        "blanks": [
            {"position": item.position, "accepted_answers": _loads(item.accepted_answers_json, [])}
            for item in question.blanks
        ],
    }
    if question.programming:
        raw["programming"] = {
            "input_markdown": question.programming.input_markdown,
            "output_markdown": question.programming.output_markdown,
            "constraints_markdown": question.programming.constraints_markdown,
            "starter_code": question.programming.starter_code,
            "reference_solution": question.programming.reference_solution,
            "time_limit_ms": question.programming.time_limit_ms,
            "memory_limit_mb": question.programming.memory_limit_mb,
            "cases": [
                {
                    "input_data": item.input_data,
                    "expected_output": item.expected_output,
                    "is_sample": item.is_sample,
                    "weight": item.weight,
                    "confirmed": False,
                    "note": item.note,
                }
                for item in question.programming.cases
            ],
        }
    return raw


def _candidate_dict(raw: dict[str, Any], sort_order: int, asset_id: int | None) -> dict[str, Any]:
    kind = _question_type(raw.get("type"))
    program = raw.get("programming") if isinstance(raw.get("programming"), dict) else None
    result: dict[str, Any] = {
        "type": kind,
        "stem_markdown": _safe_markdown(raw.get("stem_markdown")) or "（待补充题面）",
        "explanation_markdown": _safe_markdown(raw.get("explanation_markdown")),
        "points": max(1, min(10000, int(raw.get("points") or (25 if kind == "programming" else 2)))),
        "sort_order": sort_order,
        "reviewed": False,
        "correct_bool": raw.get("correct_bool") if kind == "true_false" else None,
        "source_page": int(raw.get("source_page") or 1),
        "source_end_page": int(raw.get("source_end_page") or raw.get("source_page") or 1),
        "source_section": str(raw.get("section") or "")[:180],
        "source_number": str(raw.get("number") or "")[:80],
        "recognition_confidence": _confidence_value(raw),
        "recognition_warnings": list(dict.fromkeys(str(item) for item in raw.get("_recognition_warnings") or [] if str(item).strip()))[:100],
        "source_asset_id": asset_id,
        "show_source_crop": False,
        "options": [],
        "blanks": [],
        "programming": None,
    }
    if kind in {"single_choice", "multiple_choice"}:
        result["options"] = [
            {
                "label": str(item.get("label") or chr(65 + index))[:16],
                "content_markdown": _safe_markdown(item.get("content_markdown"), 10000) or "（待补充）",
                "correct": bool(item.get("correct")),
                "sort_order": index,
            }
            for index, item in enumerate(raw.get("options") or []) if isinstance(item, dict)
        ]
    elif kind == "fill_blank":
        result["blanks"] = [
            {
                "position": index,
                "accepted_answers": list(dict.fromkeys(str(value).strip() for value in item.get("accepted_answers") or [] if str(value).strip())),
            }
            for index, item in enumerate((item for item in raw.get("blanks") or [] if isinstance(item, dict)), start=1)
        ]
    elif kind == "programming" and program is not None:
        result["programming"] = {
            "input_markdown": _safe_markdown(program.get("input_markdown"), 20000),
            "output_markdown": _safe_markdown(program.get("output_markdown"), 20000),
            "constraints_markdown": _safe_markdown(program.get("constraints_markdown"), 20000),
            "starter_code": str(program.get("starter_code") or "")[:100000],
            "reference_solution": str(program.get("reference_solution") or "")[:100000],
            "time_limit_ms": max(100, min(5000, int(program.get("time_limit_ms") or 1000))),
            "memory_limit_mb": max(32, min(512, int(program.get("memory_limit_mb") or 128))),
            "cases": [
                {
                    "input_data": str(item.get("input_data") or "")[:100000],
                    "expected_output": str(item.get("expected_output") or "")[:100000],
                    "is_sample": bool(item.get("is_sample")),
                    "weight": max(0, int(item.get("weight") or 0)),
                    "confirmed": False,
                    "note": _safe_markdown(item.get("note"), 10000),
                }
                for item in program.get("cases") or [] if isinstance(item, dict)
            ],
        }
    QuestionWrite.model_validate(result)
    return result


def _match_score(question: Question, raw: dict[str, Any]) -> float:
    if question.source_page != int(raw.get("source_page") or 1):
        return -1
    number = str(raw.get("number") or "").strip()
    section = str(raw.get("section") or "").strip()
    if number and question.source_number == number and (not section or not question.source_section or question.source_section == section):
        return 2
    similarity = SequenceMatcher(None, question.stem_markdown[:500], str(raw.get("stem_markdown") or "")[:500]).ratio()
    return similarity + (.15 if question.type == _question_type(raw.get("type")) else 0)


def _field_changes(current: dict[str, Any] | None, candidate: dict[str, Any]) -> list[str]:
    if current is None:
        return ["新增题目"]
    fields = ("type", "stem_markdown", "explanation_markdown", "points", "correct_bool", "source_page", "source_end_page", "options", "blanks", "programming", "source_asset_id")
    return [field for field in fields if current.get(field) != candidate.get(field)]


def _claim_job(session_factory: Callable[[], Session]) -> int | None:
    now = datetime.utcnow()
    stale = now - timedelta(minutes=15)
    with session_factory() as db:
        db.execute(update(QuestionRecognitionJob).where(
            QuestionRecognitionJob.status == "processing",
            QuestionRecognitionJob.processing_started_at < stale,
        ).values(status="pending", processing_started_at=None))
        job = db.scalar(select(QuestionRecognitionJob).where(
            QuestionRecognitionJob.status == "pending",
            or_(QuestionRecognitionJob.processing_started_at.is_(None), QuestionRecognitionJob.processing_started_at <= now),
        ).order_by(QuestionRecognitionJob.id).limit(1))
        if not job:
            db.commit()
            return None
        job.status = "processing"
        job.processing_started_at = now
        job.attempts += 1
        job.error = ""
        db.commit()
        return job.id


async def _process_set_job(db: Session, settings: Settings, job: QuestionRecognitionJob, source: QuestionAsset) -> dict[str, Any]:
    path = Path(settings.question_asset_dir) / source.storage_key
    document, _, payload = await parse_pdf(settings, path)
    try:
        question_set = db.get(QuestionSet, job.target_set_id)
        if not question_set:
            raise ValueError("目标题套不存在")
        available = list(question_set.questions)
        changes = []
        for index, raw in enumerate(payload.get("questions") or []):
            ranked = sorted((( _match_score(item, raw), item) for item in available), key=lambda value: value[0], reverse=True)
            matched = ranked[0][1] if ranked and ranked[0][0] >= .35 else None
            if matched:
                available.remove(matched)
            asset_id = _save_crop(db, settings, question_set.id, document, raw, index + 1, kind="question_preview")
            candidate = _candidate_dict(raw, index, asset_id)
            current = question_dict(matched) if matched else None
            changes.append({
                "status": "matched" if matched else "added",
                "question_id": matched.id if matched else None,
                "current": current,
                "candidate": candidate,
                "changed_fields": _field_changes(current, candidate),
            })
        unmatched = [
            {"status": "unmatched", "question_id": item.id, "current": question_dict(item), "candidate": None, "changed_fields": []}
            for item in sorted(available, key=lambda value: (value.sort_order, value.id))
        ]
        return {
            "title": str(payload.get("title") or question_set.title)[:180],
            "description": _safe_markdown(payload.get("description"), 5000),
            "changes": changes + unmatched,
            "diagnostics": payload.get("diagnostics") or {},
        }
    finally:
        document.close()


async def _process_question_job(db: Session, settings: Settings, job: QuestionRecognitionJob, source: QuestionAsset) -> dict[str, Any]:
    import pymupdf as fitz

    question = db.get(Question, job.target_question_id)
    question_set = db.get(QuestionSet, job.target_set_id)
    if not question or not question_set:
        raise ValueError("目标题目不存在")
    current = question_dict(question)
    raw = _raw_from_question(question)
    path = Path(settings.question_asset_dir) / source.storage_key
    document = fitz.open(path)
    original_page = question.source_page or 1
    using_question_image = source.kind != "source_pdf"
    try:
        if using_question_image:
            local_raw = deepcopy(raw)
            local_raw["source_page"] = 1
            local_raw["source_end_page"] = 1
            reviewed = await _request_focused_review(settings, document, local_raw, allow_type_change=True)
            repair_crop_regions(document, [reviewed])
            asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
            reviewed["source_page"] = original_page
            reviewed["source_end_page"] = question.source_end_page or original_page
        else:
            reviewed = await _request_focused_review(settings, document, raw, allow_type_change=True)
            repair_crop_regions(document, [reviewed])
            asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
        if asset_id is None and question_set.source_pdf_asset_id and source.id != question_set.source_pdf_asset_id:
            pdf_asset = db.get(QuestionAsset, question_set.source_pdf_asset_id)
            if pdf_asset:
                document.close()
                document = fitz.open(Path(settings.question_asset_dir) / pdf_asset.storage_key)
                reviewed = await _request_focused_review(settings, document, raw, allow_type_change=True)
                repair_crop_regions(document, [reviewed])
                asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
        candidate = _candidate_dict(reviewed, question.sort_order, asset_id)
        return {
            "title": question_set.title,
            "description": question_set.description,
            "changes": [{
                "status": "matched",
                "question_id": question.id,
                "current": current,
                "candidate": candidate,
                "changed_fields": _field_changes(current, candidate),
            }],
            "diagnostics": {"warnings": candidate["recognition_warnings"]},
        }
    finally:
        document.close()


async def _process_job(session_factory: Callable[[], Session], settings: Settings, job_id: int) -> None:
    try:
        with session_factory() as db:
            job = db.get(QuestionRecognitionJob, job_id)
            source = db.get(QuestionAsset, job.source_asset_id) if job else None
            if not job or not source:
                return
            result = await (_process_question_job(db, settings, job, source) if job.scope == "question" else _process_set_job(db, settings, job, source))
            job.result_json = json.dumps(result, ensure_ascii=False)
            job.diagnostics_json = json.dumps(result.get("diagnostics") or {}, ensure_ascii=False)
            job.status = "ready"
            job.processing_started_at = None
            db.commit()
    except Exception as exc:
        detail = _import_error_detail(exc)
        with session_factory() as db:
            job = db.get(QuestionRecognitionJob, job_id)
            if job:
                job.error = detail
                job.status = "failed" if job.attempts >= settings.import_llm_max_retries else "pending"
                job.processing_started_at = None if job.status == "failed" else datetime.utcnow() + timedelta(seconds=min(300, 2 ** job.attempts))
                db.commit()
        logger.error("Question recognition job %s failed: %s", job_id, detail, exc_info=True)


async def question_recognition_worker(session_factory: Callable[[], Session], settings: Settings) -> None:
    while True:
        job_id = _claim_job(session_factory)
        if job_id is None:
            await asyncio.sleep(1)
            continue
        await _process_job(session_factory, settings, job_id)


def job_dict(db: Session, job: QuestionRecognitionJob, include_result: bool = True) -> dict[str, Any]:
    question_set = db.get(QuestionSet, job.target_set_id)
    question = db.get(Question, job.target_question_id) if job.target_question_id else None
    stale = job.status in {"pending", "processing", "ready"} and (
        not question_set or target_fingerprint(question_set, question if job.scope == "question" else None) != job.target_fingerprint
    )
    result = _loads(job.result_json, {}) if include_result else None
    return {
        "id": job.id,
        "scope": job.scope,
        "status": job.status,
        "target_set_id": job.target_set_id,
        "target_question_id": job.target_question_id,
        "model": job.model,
        "base_url": job.base_url,
        "reasoning_effort": job.reasoning_effort or None,
        "attempts": job.attempts,
        "error": job.error,
        "stale": stale,
        "result": result,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "applied_at": job.applied_at,
    }


def apply_job(db: Session, job: QuestionRecognitionJob) -> QuestionSet:
    if job.status != "ready":
        raise ValueError("重新识别结果尚不可应用")
    question_set = db.get(QuestionSet, job.target_set_id)
    question = db.get(Question, job.target_question_id) if job.target_question_id else None
    if not question_set or question_set.status != "draft":
        raise ValueError("只能向草稿题套应用重新识别结果")
    if target_fingerprint(question_set, question if job.scope == "question" else None) != job.target_fingerprint:
        raise RuntimeError("题目内容已变化，重新识别结果已过期")
    result = _loads(job.result_json, {})
    next_order = 0
    unmatched_items: list[Question] = []
    for change in result.get("changes") or []:
        status = change.get("status")
        candidate = change.get("candidate")
        if status == "unmatched":
            old = db.get(Question, int(change.get("question_id") or 0))
            if old:
                warnings = _loads(old.recognition_warnings_json, [])
                warnings.append("整套重新识别未匹配，请人工核对")
                old.recognition_warnings_json = json.dumps(list(dict.fromkeys(warnings)), ensure_ascii=False)
                old.reviewed = False
                unmatched_items.append(old)
            continue
        if not isinstance(candidate, dict):
            continue
        item = db.get(Question, int(change.get("question_id") or 0)) if status == "matched" else None
        if item is None:
            item = Question(question_set_id=question_set.id, type=candidate["type"], stem_markdown=candidate["stem_markdown"])
            db.add(item)
        else:
            candidate["show_source_crop"] = item.show_source_crop
            if not candidate.get("source_asset_id"):
                candidate["source_asset_id"] = item.source_asset_id
        candidate["sort_order"] = next_order if job.scope == "set" else item.sort_order
        replace_question(item, QuestionWrite.model_validate(candidate))
        if item.source_asset_id:
            applied_asset = db.get(QuestionAsset, item.source_asset_id)
            if applied_asset and applied_asset.kind == "question_preview":
                applied_asset.kind = "question"
        item.reviewed = False
        if job.scope == "set":
            next_order += 1
    if job.scope == "set":
        for item in unmatched_items:
            item.sort_order = next_order
            next_order += 1
        question_set.title = str(result.get("title") or question_set.title)[:180]
        question_set.description = _safe_markdown(result.get("description"), 5000)
    job.status = "applied"
    job.applied_at = datetime.utcnow()
    db.commit()
    return question_set
