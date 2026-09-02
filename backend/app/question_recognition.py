import asyncio
import hashlib
import json
import logging
from copy import deepcopy
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Awaitable, Callable

from pydantic import ValidationError
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .exercise_library import question_dict, replace_question
from .exercise_schemas import QuestionWrite
from .job_control import progress_payload, register_active_job, unregister_active_job
from .models import Question, QuestionAsset, QuestionRecognitionJob, QuestionSet
from .question_imports import (
    _confidence_value,
    _boolean_value,
    _bounded_int,
    _crop_is_suspicious,
    _emit_progress,
    _import_error_detail,
    _mapping_items,
    _question_type,
    _request_focused_review,
    _safe_markdown,
    _save_crop,
    candidate_validation_errors,
    parse_pdf,
    repair_crop_regions,
)
from .sample_explanations import structure_candidate_sample_explanations


logger = logging.getLogger("uvicorn.error")
ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


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
                    "explanation_markdown": item.explanation_markdown,
                }
                for item in question.programming.cases
            ],
        }
    return raw


def _candidate_preview(raw: dict[str, Any], sort_order: int, asset_id: int | None) -> dict[str, Any]:
    structure_candidate_sample_explanations(raw)
    kind = _question_type(raw.get("type"))
    program = raw.get("programming") if isinstance(raw.get("programming"), dict) else None
    source_page = _bounded_int(raw.get("source_page"), 1, 1, 10000)
    result: dict[str, Any] = {
        "type": kind,
        "stem_markdown": _safe_markdown(raw.get("stem_markdown")) or "（待补充题面）",
        "explanation_markdown": _safe_markdown(raw.get("explanation_markdown")),
        "points": _bounded_int(raw.get("points"), 25 if kind == "programming" else 2, 1, 10000),
        "sort_order": sort_order,
        "reviewed": False,
        "correct_bool": _boolean_value(raw.get("correct_bool")) if kind == "true_false" else None,
        "source_page": source_page,
        "source_end_page": max(source_page, _bounded_int(raw.get("source_end_page"), source_page, 1, 10000)),
        "source_section": str(raw.get("section") or "")[:180],
        "source_number": str(raw.get("number") or "")[:80],
        "recognition_confidence": _confidence_value(raw),
        "recognition_warnings": list(dict.fromkeys(str(item) for item in raw.get("_recognition_warnings") or [] if str(item).strip()))[:100],
        "source_asset_id": asset_id,
        "stem_image_asset_id": None,
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
                "correct": _boolean_value(item.get("correct")) is True,
                "sort_order": index,
            }
            for index, item in enumerate(_mapping_items(raw.get("options")))
        ]
    elif kind == "fill_blank":
        result["blanks"] = [
            {
                "position": index,
                "accepted_answers": list(dict.fromkeys(str(value).strip() for value in (item.get("accepted_answers") if isinstance(item.get("accepted_answers"), list) else []) if str(value).strip())),
            }
            for index, item in enumerate(_mapping_items(raw.get("blanks")), start=1)
        ]
    elif kind == "programming" and program is not None:
        result["programming"] = {
            "input_markdown": _safe_markdown(program.get("input_markdown"), 20000),
            "output_markdown": _safe_markdown(program.get("output_markdown"), 20000),
            "constraints_markdown": _safe_markdown(program.get("constraints_markdown"), 20000),
            "starter_code": str(program.get("starter_code") or "")[:100000],
            "reference_solution": str(program.get("reference_solution") or "")[:100000],
            "time_limit_ms": _bounded_int(program.get("time_limit_ms"), 1000, 100, 5000),
            "memory_limit_mb": _bounded_int(program.get("memory_limit_mb"), 128, 32, 512),
            "cases": [
                {
                    "input_data": str(item.get("input_data") or "")[:100000],
                    "expected_output": str(item.get("expected_output") or "")[:100000],
                    "is_sample": bool(item.get("is_sample")),
                    "weight": _bounded_int(item.get("weight"), 0, 0, 10000),
                    "confirmed": False,
                    "note": _safe_markdown(item.get("note"), 10000),
                    "explanation_markdown": _safe_markdown(item.get("explanation_markdown"), 10000),
                }
                for item in _mapping_items(program.get("cases"))
            ],
        }
    return result


def _candidate_dict(raw: dict[str, Any], sort_order: int, asset_id: int | None) -> dict[str, Any]:
    result = _candidate_preview(raw, sort_order, asset_id)
    QuestionWrite.model_validate(result)
    return result


def _validation_messages(raw: dict[str, Any], exc: ValidationError | None = None) -> list[str]:
    errors = list(raw.get("_validation_errors") or candidate_validation_errors(raw))
    if exc and not errors:
        errors.extend(str(item.get("msg") or "候选题目结构无效").removeprefix("Value error, ") for item in exc.errors())
    return list(dict.fromkeys(item for item in errors if item))


def _match_score(question: Question, raw: dict[str, Any]) -> float:
    if question.source_page != _bounded_int(raw.get("source_page"), 1, 1, 10000):
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
        job.diagnostics_json = json.dumps({
            "progress": progress_payload("starting", "正在启动重新识别", 1, detail=f"第 {job.attempts} 次尝试"),
        }, ensure_ascii=False)
        db.commit()
        return job.id


def _progress_callback(session_factory: Callable[[], Session], job_id: int) -> ProgressCallback:
    async def report(progress: dict[str, Any]) -> None:
        with session_factory() as db:
            job = db.get(QuestionRecognitionJob, job_id)
            if not job or job.status == "cancelled":
                raise asyncio.CancelledError
            if job.status != "processing":
                return
            diagnostics = _loads(job.diagnostics_json, {})
            diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
            previous = diagnostics.get("progress") if isinstance(diagnostics.get("progress"), dict) else {}
            progress["percent"] = max(int(previous.get("percent") or 0), int(progress.get("percent") or 0))
            diagnostics["progress"] = progress
            job.diagnostics_json = json.dumps(diagnostics, ensure_ascii=False)
            db.commit()

    return report


async def _process_set_job(
    db: Session,
    settings: Settings,
    job: QuestionRecognitionJob,
    source: QuestionAsset,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    path = Path(settings.question_asset_dir) / source.storage_key
    document, _, payload = await (parse_pdf(settings, path, progress_callback) if progress_callback else parse_pdf(settings, path))
    try:
        question_set = db.get(QuestionSet, job.target_set_id)
        if not question_set:
            raise ValueError("目标题套不存在")
        available = list(question_set.questions)
        changes = []
        await _emit_progress(
            progress_callback,
            "diff_generation",
            "正在生成题目差异",
            92,
            current=0,
            total=len(payload.get("questions") or []),
            unit="question",
            detail="正在匹配原题并生成候选截图",
        )
        for index, raw in enumerate(payload.get("questions") or []):
            ranked = sorted((( _match_score(item, raw), item) for item in available), key=lambda value: value[0], reverse=True)
            matched = ranked[0][1] if ranked and ranked[0][0] >= .35 else None
            if matched:
                available.remove(matched)
            asset_id = _save_crop(db, settings, question_set.id, document, raw, index + 1, kind="question_preview")
            current = question_dict(matched) if matched else None
            validation_errors: list[str] = []
            try:
                candidate = _candidate_dict(raw, index, asset_id)
                status = "matched" if matched else "added"
            except ValidationError as exc:
                candidate = _candidate_preview(raw, index, asset_id)
                validation_errors = _validation_messages(raw, exc)
                status = "invalid"
            changes.append({
                "status": status,
                "question_id": matched.id if matched else None,
                "current": current,
                "candidate": candidate,
                "changed_fields": _field_changes(current, candidate),
                "validation_errors": validation_errors,
                "repair_attempted": bool(raw.get("_repair_attempted")),
            })
        unmatched = [
            {"status": "unmatched", "question_id": item.id, "current": question_dict(item), "candidate": None, "changed_fields": []}
            for item in sorted(available, key=lambda value: (value.sort_order, value.id))
        ]
        diagnostics = deepcopy(payload.get("diagnostics") or {})
        diagnostics["invalid_count"] = sum(item["status"] == "invalid" for item in changes)
        return {
            "title": str(payload.get("title") or question_set.title)[:180],
            "description": _safe_markdown(payload.get("description"), 5000),
            "changes": changes + unmatched,
            "diagnostics": diagnostics,
        }
    finally:
        document.close()


async def _process_question_job(
    db: Session,
    settings: Settings,
    job: QuestionRecognitionJob,
    source: QuestionAsset,
    progress_callback: ProgressCallback | None = None,
) -> dict[str, Any]:
    import pymupdf as fitz

    question = db.get(Question, job.target_question_id)
    question_set = db.get(QuestionSet, job.target_set_id)
    if not question or not question_set:
        raise ValueError("目标题目不存在")
    current = question_dict(question)
    raw = _raw_from_question(question)
    path = Path(settings.question_asset_dir) / source.storage_key
    await _emit_progress(progress_callback, "reading_source", "正在读取原题", 10, detail="正在准备题目图片与定位信息")
    document = fitz.open(path)
    original_page = question.source_page or 1
    using_question_image = source.kind != "source_pdf"
    try:
        if using_question_image:
            local_raw = deepcopy(raw)
            local_raw["source_page"] = 1
            local_raw["source_end_page"] = 1
            await _emit_progress(progress_callback, "model_review", "正在重新识别本题", 25, current=1, total=1, unit="question", detail="正在等待模型返回单题识别结果")
            reviewed = await _request_focused_review(settings, document, local_raw, allow_type_change=True)
            await _emit_progress(progress_callback, "validation", "正在校验识别结果", 80, current=1, total=1, unit="question", detail="模型已返回，正在校验题型与答案")
            repair_crop_regions(document, [reviewed])
            await _emit_progress(progress_callback, "crop_processing", "正在生成候选截图", 86, current=1, total=1, unit="question", detail="正在裁剪本题原图")
            asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
            reviewed["source_page"] = original_page
            reviewed["source_end_page"] = question.source_end_page or original_page
        else:
            await _emit_progress(progress_callback, "model_review", "正在重新识别本题", 25, current=1, total=1, unit="question", detail="正在等待模型返回单题识别结果")
            reviewed = await _request_focused_review(settings, document, raw, allow_type_change=True)
            await _emit_progress(progress_callback, "validation", "正在校验识别结果", 80, current=1, total=1, unit="question", detail="模型已返回，正在校验题型与答案")
            repair_crop_regions(document, [reviewed])
            await _emit_progress(progress_callback, "crop_processing", "正在生成候选截图", 86, current=1, total=1, unit="question", detail="正在裁剪本题原图")
            asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
        if asset_id is None and question_set.source_pdf_asset_id and source.id != question_set.source_pdf_asset_id:
            pdf_asset = db.get(QuestionAsset, question_set.source_pdf_asset_id)
            if pdf_asset:
                document.close()
                document = fitz.open(Path(settings.question_asset_dir) / pdf_asset.storage_key)
                await _emit_progress(progress_callback, "model_review", "正在从原 PDF 重试", 25, current=1, total=1, unit="question", detail="当前图片无法可靠裁剪，正在等待模型从原 PDF 重新定位")
                reviewed = await _request_focused_review(settings, document, raw, allow_type_change=True)
                await _emit_progress(progress_callback, "validation", "正在校验识别结果", 80, current=1, total=1, unit="question", detail="模型已返回，正在校验题型与答案")
                repair_crop_regions(document, [reviewed])
                await _emit_progress(progress_callback, "crop_processing", "正在生成候选截图", 86, current=1, total=1, unit="question", detail="正在裁剪本题原图")
                asset_id = _save_crop(db, settings, question_set.id, document, reviewed, question.id, kind="question_preview")
        try:
            candidate = _candidate_dict(reviewed, question.sort_order, asset_id)
            status = "matched"
            validation_errors: list[str] = []
        except ValidationError as exc:
            candidate = _candidate_preview(reviewed, question.sort_order, asset_id)
            status = "invalid"
            validation_errors = _validation_messages(reviewed, exc)
        return {
            "title": question_set.title,
            "description": question_set.description,
            "changes": [{
                "status": status,
                "question_id": question.id,
                "current": current,
                "candidate": candidate,
                "changed_fields": _field_changes(current, candidate),
                "validation_errors": validation_errors,
                "repair_attempted": True,
            }],
            "diagnostics": {
                "warnings": list(dict.fromkeys(candidate["recognition_warnings"] + validation_errors)),
                "invalid_count": 1 if status == "invalid" else 0,
            },
        }
    finally:
        document.close()


async def _process_job(session_factory: Callable[[], Session], settings: Settings, job_id: int) -> None:
    progress = _progress_callback(session_factory, job_id)
    try:
        with session_factory() as db:
            job = db.get(QuestionRecognitionJob, job_id)
            source = db.get(QuestionAsset, job.source_asset_id) if job else None
            if not job or not source or job.status == "cancelled":
                return
            result = await (
                _process_question_job(db, settings, job, source, progress)
                if job.scope == "question"
                else _process_set_job(db, settings, job, source, progress)
            )
            diagnostics = dict(result.get("diagnostics") or {})
            question_count = len(result.get("changes") or [])
            diagnostics["progress"] = progress_payload(
                "completed",
                "重新识别完成",
                100,
                current=question_count,
                total=question_count,
                unit="question",
                detail="候选结果已生成，等待管理员确认",
            )
            updated = db.execute(update(QuestionRecognitionJob).where(
                QuestionRecognitionJob.id == job_id,
                QuestionRecognitionJob.status == "processing",
            ).values(
                result_json=json.dumps(result, ensure_ascii=False),
                diagnostics_json=json.dumps(diagnostics, ensure_ascii=False),
                status="ready",
                processing_started_at=None,
            ))
            if updated.rowcount != 1:
                db.rollback()
                return
            db.commit()
    except asyncio.CancelledError:
        logger.info("Question recognition job %s was cancelled or interrupted", job_id)
        raise
    except Exception as exc:
        detail = _import_error_detail(exc)
        with session_factory() as db:
            job = db.get(QuestionRecognitionJob, job_id)
            if job and job.status != "cancelled":
                diagnostics = _loads(job.diagnostics_json, {})
                diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
                previous = diagnostics.get("progress") if isinstance(diagnostics.get("progress"), dict) else {}
                terminal = job.attempts >= settings.import_llm_max_retries
                diagnostics["progress"] = progress_payload(
                    "failed" if terminal else "retry_wait",
                    "重新识别失败" if terminal else "等待自动重试",
                    int(previous.get("percent") or 0),
                    detail=detail[:500],
                )
                job.error = detail
                job.status = "failed" if terminal else "pending"
                job.processing_started_at = None if job.status == "failed" else datetime.utcnow() + timedelta(seconds=min(300, 2 ** job.attempts))
                job.diagnostics_json = json.dumps(diagnostics, ensure_ascii=False)
                db.commit()
        logger.error("Question recognition job %s failed: %s", job_id, detail, exc_info=True)


async def question_recognition_worker(session_factory: Callable[[], Session], settings: Settings) -> None:
    while True:
        job_id = _claim_job(session_factory)
        if job_id is None:
            await asyncio.sleep(1)
            continue
        task = asyncio.create_task(_process_job(session_factory, settings, job_id))
        register_active_job("recognition", job_id, task)
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current and current.cancelling():
                raise
        finally:
            unregister_active_job("recognition", job_id, task)


def job_dict(db: Session, job: QuestionRecognitionJob, include_result: bool = True) -> dict[str, Any]:
    question_set = db.get(QuestionSet, job.target_set_id)
    question = db.get(Question, job.target_question_id) if job.target_question_id else None
    stale = job.status in {"pending", "processing", "ready"} and (
        not question_set or target_fingerprint(question_set, question if job.scope == "question" else None) != job.target_fingerprint
    )
    result = _loads(job.result_json, {}) if include_result else None
    diagnostics = _loads(job.diagnostics_json, {})
    diagnostics = diagnostics if isinstance(diagnostics, dict) else {}
    progress = diagnostics.get("progress") if isinstance(diagnostics.get("progress"), dict) else None
    if progress is None:
        fallback = {
            "pending": ("queued", "等待重新识别", 0),
            "processing": ("processing", "正在重新识别", 1),
            "ready": ("completed", "重新识别完成", 100),
            "applied": ("completed", "结果已应用", 100),
            "cancelled": ("cancelled", "已终止", 0),
            "failed": ("failed", "重新识别失败", 0),
        }.get(job.status, (job.status, job.status, 0))
        progress = progress_payload(*fallback)
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
        "progress": progress,
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
    if job.scope == "question" and any(item.get("status") == "invalid" for item in result.get("changes") or [] if isinstance(item, dict)):
        raise ValueError("单题重新识别结果无效，不能应用，请重试或人工编辑")
    next_order = 0
    unmatched_items: list[Question] = []
    for change in result.get("changes") or []:
        status = change.get("status")
        candidate = change.get("candidate")
        if status == "invalid":
            old = db.get(Question, int(change.get("question_id") or 0))
            if old:
                warnings = _loads(old.recognition_warnings_json, [])
                errors = [str(item) for item in change.get("validation_errors") or [] if str(item).strip()]
                warning = "重新识别结果无效，请人工核对" + ("：" + "；".join(errors) if errors else "")
                warnings.append(warning)
                old.recognition_warnings_json = json.dumps(list(dict.fromkeys(warnings))[:100], ensure_ascii=False)
                old.reviewed = False
                if job.scope == "set":
                    old.sort_order = next_order
                    next_order += 1
            continue
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
            candidate["stem_image_asset_id"] = item.stem_image_asset_id
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
    _mapping_items,
