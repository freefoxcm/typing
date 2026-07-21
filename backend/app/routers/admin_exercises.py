import csv
import io
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from ..config import Settings, get_settings
from ..database import get_db
from ..exercise_library import publication_errors, question_dict, question_set_dict, replace_question
from ..exercise_schemas import QuestionSetWrite, QuestionWrite
from ..judge_queue import enqueue, result as judge_result
from ..models import (
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    ProgrammingCase,
    ProgrammingSpec,
    Question,
    QuestionAsset,
    QuestionImportJob,
    QuestionSet,
    WrongQuestion,
)
from ..question_imports import import_llm_configured
from ..security import Principal, current_principal, require_admin


router = APIRouter(tags=["exercise-admin"])


def _sets_query():
    return select(QuestionSet).options(
        selectinload(QuestionSet.questions).selectinload(Question.options),
        selectinload(QuestionSet.questions).selectinload(Question.programming).selectinload(ProgrammingSpec.cases),
    ).order_by(QuestionSet.created_at.desc())


def _get_set(db: Session, set_id: int) -> QuestionSet:
    item = db.scalar(_sets_query().where(QuestionSet.id == set_id))
    if not item:
        raise HTTPException(status_code=404, detail="题套不存在")
    return item


def _editable(question_set: QuestionSet) -> None:
    if question_set.status == "published":
        raise HTTPException(status_code=409, detail="请先撤回已发布题套再编辑")
    if question_set.status == "archived":
        raise HTTPException(status_code=409, detail="归档题套不可编辑")


@router.get("/api/admin/import-llm/status")
def import_llm_status(_principal: Principal = Depends(require_admin), settings: Settings = Depends(get_settings)):
    return {
        "configured": import_llm_configured(settings),
        "base_url": settings.import_llm_base_url,
        "model": settings.import_llm_model,
        "batch_pages": settings.import_llm_batch_pages,
    }


@router.post("/api/admin/question-imports", status_code=202)
async def create_import(
    file: UploadFile = File(...),
    _principal: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
):
    if not import_llm_configured(settings):
        raise HTTPException(status_code=409, detail="请先配置独立的 PDF 识别模型")
    if file.content_type not in {"application/pdf", "application/octet-stream"} and not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="仅支持 PDF 文件")
    limit = settings.import_max_file_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if not data or len(data) > limit:
        raise HTTPException(status_code=413, detail=f"PDF 不能超过 {settings.import_max_file_mb} MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(status_code=422, detail="文件不是有效的 PDF")
    root = Path(settings.question_asset_dir)
    root.mkdir(parents=True, exist_ok=True)
    key = f"source-{uuid4().hex}.pdf"
    (root / key).write_bytes(data)
    asset = QuestionAsset(storage_key=key, original_name=(file.filename or "试卷.pdf")[:255], mime_type="application/pdf", kind="source_pdf", size_bytes=len(data))
    db.add(asset)
    db.flush()
    job = QuestionImportJob(source_asset_id=asset.id, status="pending")
    db.add(job)
    db.commit()
    db.refresh(job)
    return {"id": job.id, "status": job.status, "created_at": job.created_at}


@router.get("/api/admin/question-imports")
def list_imports(_principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    items = db.scalars(select(QuestionImportJob).order_by(QuestionImportJob.created_at.desc()).limit(100)).all()
    return [{
        "id": item.id,
        "status": item.status,
        "question_set_id": item.question_set_id,
        "page_count": item.page_count,
        "error": item.error,
        "attempts": item.attempts,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    } for item in items]


@router.get("/api/admin/question-imports/{job_id}")
def get_import(job_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.get(QuestionImportJob, job_id)
    if not item:
        raise HTTPException(status_code=404, detail="导入任务不存在")
    return {
        "id": item.id, "status": item.status, "question_set_id": item.question_set_id,
        "page_count": item.page_count, "error": item.error, "attempts": item.attempts,
        "created_at": item.created_at, "updated_at": item.updated_at,
    }


@router.post("/api/admin/question-imports/{job_id}/retry")
def retry_import(job_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    if not import_llm_configured(settings):
        raise HTTPException(status_code=409, detail="请先配置独立的 PDF 识别模型")
    item = db.get(QuestionImportJob, job_id)
    if not item:
        raise HTTPException(status_code=404, detail="导入任务不存在")
    if item.status not in {"failed", "pending"}:
        raise HTTPException(status_code=409, detail="当前任务不能重试")
    item.status = "pending"
    item.attempts = 0
    item.error = ""
    item.processing_started_at = None
    db.commit()
    return {"ok": True, "status": item.status}


@router.get("/api/admin/question-sets")
def list_sets(_principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return [question_set_dict(item) for item in db.scalars(_sets_query()).unique().all()]


@router.get("/api/admin/question-sets/{set_id}")
def get_set(set_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    return question_set_dict(_get_set(db, set_id))


@router.post("/api/admin/question-sets", status_code=201)
def create_set(payload: QuestionSetWrite, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = QuestionSet(title=payload.title, description=payload.description, status="draft")
    db.add(item)
    db.commit()
    db.refresh(item)
    return question_set_dict(item)


@router.put("/api/admin/question-sets/{set_id}")
def update_set(set_id: int, payload: QuestionSetWrite, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = _get_set(db, set_id)
    _editable(item)
    item.title = payload.title
    item.description = payload.description
    db.commit()
    return question_set_dict(_get_set(db, set_id))


@router.post("/api/admin/question-sets/{set_id}/publish")
def publish_set(set_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = _get_set(db, set_id)
    if item.status == "archived":
        raise HTTPException(status_code=409, detail="归档题套不能发布")
    errors = publication_errors(item)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "题套尚不能发布", "errors": errors[:100]})
    item.status = "published"
    item.published_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "status": item.status}


@router.post("/api/admin/question-sets/{set_id}/unpublish")
def unpublish_set(set_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = _get_set(db, set_id)
    if item.status != "published":
        raise HTTPException(status_code=409, detail="题套当前不是已发布状态")
    item.status = "draft"
    item.published_at = None
    db.commit()
    return {"ok": True, "status": item.status}


@router.post("/api/admin/question-sets/{set_id}/archive")
def archive_set(set_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = _get_set(db, set_id)
    item.status = "archived"
    db.commit()
    return {"ok": True, "status": item.status}


@router.post("/api/admin/question-sets/{set_id}/questions", status_code=201)
def create_question(set_id: int, payload: QuestionWrite, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    question_set = _get_set(db, set_id)
    _editable(question_set)
    item = Question(question_set_id=set_id, type=payload.type, stem_markdown=payload.stem_markdown)
    replace_question(item, payload)
    db.add(item)
    db.commit()
    db.refresh(item)
    return question_dict(item)


@router.put("/api/admin/questions/{question_id}")
def update_question(question_id: int, payload: QuestionWrite, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.get(Question, question_id)
    if not item:
        raise HTTPException(status_code=404, detail="题目不存在")
    _editable(db.get(QuestionSet, item.question_set_id))
    replace_question(item, payload)
    db.commit()
    return question_dict(db.get(Question, question_id))


@router.delete("/api/admin/questions/{question_id}", status_code=204)
def delete_question(question_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    item = db.get(Question, question_id)
    if not item:
        raise HTTPException(status_code=404, detail="题目不存在")
    _editable(db.get(QuestionSet, item.question_set_id))
    db.delete(item)
    db.commit()


@router.post("/api/admin/questions/{question_id}/reference-output", status_code=202)
def generate_reference_outputs(question_id: int, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    item = db.get(Question, question_id)
    if not item or item.type != "programming" or not item.programming:
        raise HTTPException(status_code=404, detail="编程题不存在")
    _editable(db.get(QuestionSet, item.question_set_id))
    candidates = [case for case in item.programming.cases if not case.is_sample]
    if not item.programming.reference_solution.strip() or not candidates:
        raise HTTPException(status_code=422, detail="请先填写参考程序和隐藏测试输入")
    job_id = enqueue(settings, {
        "kind": "reference",
        "question_id": item.id,
        "code": item.programming.reference_solution,
        "time_limit_ms": item.programming.time_limit_ms,
        "memory_limit_mb": item.programming.memory_limit_mb,
        "cases": [{"id": case.id, "input": case.input_data, "expected": "", "weight": case.weight} for case in candidates],
    })
    return {"job_id": job_id, "status": "queued"}


@router.get("/api/admin/reference-output/{job_id}")
def reference_output(job_id: str, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    payload = judge_result(settings, job_id)
    if payload is None:
        return {"job_id": job_id, "status": "queued"}
    question_id = int(payload.get("question_id") or 0)
    item = db.get(Question, question_id)
    if not item or not item.programming:
        raise HTTPException(status_code=404, detail="对应编程题不存在")
    by_id = {case.id: case for case in item.programming.cases if not case.is_sample}
    for case_result in payload.get("cases", []):
        case = by_id.get(int(case_result.get("id") or 0))
        if case and case_result.get("status") == "AC":
            case.expected_output = str(case_result.get("stdout", ""))
            case.confirmed = False
    item.reviewed = False
    db.commit()
    return {"job_id": job_id, "status": payload.get("status", "failed"), "cases": payload.get("cases", [])}


@router.get("/api/question-assets/{asset_id}")
def question_asset(asset_id: int, principal: Principal = Depends(current_principal), db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    asset = db.get(QuestionAsset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="资源不存在")
    if principal.role == "child":
        published = asset.question_set_id and db.scalar(select(QuestionSet.id).where(QuestionSet.id == asset.question_set_id, QuestionSet.status == "published"))
        used_by_child = db.scalar(
            select(ExerciseSessionItem.id)
            .join(ExerciseSession, ExerciseSession.id == ExerciseSessionItem.session_id)
            .where(ExerciseSession.child_id == principal.actor_id, ExerciseSessionItem.snapshot_json.like(f'%"source_asset_id": {asset.id}%'))
            .limit(1)
        )
        if not published and not used_by_child:
            raise HTTPException(status_code=404, detail="资源不存在")
    path = Path(settings.question_asset_dir) / asset.storage_key
    if not path.is_file():
        raise HTTPException(status_code=404, detail="资源文件不存在")
    return FileResponse(path, media_type=asset.mime_type, filename=asset.original_name if asset.kind == "source_pdf" else None)


@router.get("/api/admin/exercise-reports/summary")
def exercise_report(days: int = 30, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    days = max(1, min(3650, days))
    since = datetime.utcnow() - timedelta(days=days)
    sessions = db.scalars(select(ExerciseSession).where(ExerciseSession.created_at >= since, ExerciseSession.status == "completed").order_by(ExerciseSession.created_at.desc())).all()
    wrong_count = db.scalar(select(func.count(WrongQuestion.id)).where(WrongQuestion.mastered.is_(False))) or 0
    average = round(sum((item.score / item.max_score * 100) if item.max_score else 0 for item in sessions) / len(sessions), 1) if sessions else 0
    return {
        "session_count": len(sessions), "average_percent": average, "unresolved_wrong_count": wrong_count,
        "recent": [{"id": item.id, "child_id": item.child_id, "title": item.title, "score": item.score, "max_score": item.max_score, "completed_at": item.completed_at} for item in sessions[:50]],
    }


@router.get("/api/admin/exercise-reports/export.csv")
def export_exercise_report(days: int = 30, _principal: Principal = Depends(require_admin), db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(days=max(1, min(3650, days)))
    sessions = db.scalars(select(ExerciseSession).where(ExerciseSession.created_at >= since).order_by(ExerciseSession.created_at.desc())).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["session_id", "child_id", "mode", "status", "title", "score", "max_score", "created_at", "completed_at"])
    for item in sessions:
        writer.writerow([item.id, item.child_id, item.mode, item.status, item.title, item.score, item.max_score, item.created_at.isoformat(), item.completed_at.isoformat() if item.completed_at else ""])
    return StreamingResponse(iter([output.getvalue().encode("utf-8-sig")]), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=exercise-report.csv"})
