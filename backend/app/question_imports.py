import asyncio
import base64
import json
import logging
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .models import ProgrammingCase, ProgrammingSpec, Question, QuestionAsset, QuestionImportJob, QuestionOption, QuestionSet


logger = logging.getLogger("uvicorn.error")


def _redact_secret(value: str) -> str:
    text = re.sub(r"Bearer\s+\S+", "Bearer ***", value, flags=re.IGNORECASE)
    text = re.sub(r"\bsk-[A-Za-z0-9_-]{12,}\b", "sk-***", text)
    text = re.sub(r"([?&](?:api[_-]?key|token)=)[^&\s；,}\"']+", r"\1***", text, flags=re.IGNORECASE)
    return text


def _import_error_detail(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        request_id = (
            response.headers.get("x-request-id")
            or response.headers.get("request-id")
            or response.headers.get("x-minimax-request-id")
        )
        try:
            body = json.dumps(response.json(), ensure_ascii=False)
        except (ValueError, TypeError):
            body = response.text
        parts = [
            f"上游模型接口返回 HTTP {response.status_code}",
            f"{response.request.method} {response.request.url}",
        ]
        if request_id:
            parts.append(f"request_id={request_id}")
        if body.strip():
            parts.append(body.strip())
        return _redact_secret("；".join(parts))[:2000]
    if isinstance(exc, httpx.TimeoutException):
        return _redact_secret(f"请求识别模型超时：{exc}")[:2000]
    if isinstance(exc, httpx.RequestError):
        return _redact_secret(f"无法连接识别模型：{exc}")[:2000]
    return _redact_secret(f"{type(exc).__name__}: {exc}")[:2000]


def import_llm_configured(settings: Settings) -> bool:
    return bool(settings.import_llm_api_key.strip() and settings.import_llm_model.strip() and settings.import_llm_base_url.strip())


def _json_content(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("识别模型未返回 JSON 对象")
    payload = json.loads(text[start:end + 1])
    if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
        raise ValueError("识别结果缺少 questions 数组")
    return payload


def _safe_markdown(value: Any, limit: int = 50000) -> str:
    text = str(value or "").strip()[:limit]
    return text.replace("<", "&lt;").replace(">", "&gt;")


def _question_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "single": "single_choice", "single_choice": "single_choice", "单选": "single_choice", "单选题": "single_choice",
        "multiple": "multiple_choice", "multiple_choice": "multiple_choice", "多选": "multiple_choice", "多选题": "multiple_choice",
        "true_false": "true_false", "judgment": "true_false", "判断": "true_false", "判断题": "true_false",
        "programming": "programming", "code": "programming", "编程": "programming", "编程题": "programming",
    }
    return aliases.get(text, "single_choice")


def _extract_pages(path: Path, settings: Settings) -> tuple[Any, list[dict[str, Any]]]:
    try:
        import pymupdf as fitz
    except ImportError as exc:
        raise RuntimeError("PDF 解析组件 PyMuPDF 未安装") from exc
    document = fitz.open(path)
    if document.page_count > settings.import_max_pages:
        document.close()
        raise ValueError(f"PDF 超过 {settings.import_max_pages} 页限制")
    pages: list[dict[str, Any]] = []
    for index, page in enumerate(document):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
        pages.append({
            "number": index + 1,
            "text": page.get_text("text")[:30000],
            "png": pixmap.tobytes("png"),
            "width": page.rect.width,
            "height": page.rect.height,
        })
    return document, pages


async def _request_batch(settings: Settings, pages: list[dict[str, Any]]) -> dict[str, Any]:
    schema = (
        '只返回 JSON：{"title":"题套标题","description":"说明","questions":[{'
        '"number":"1","type":"single_choice|multiple_choice|true_false|programming",'
        '"stem_markdown":"题面","explanation_markdown":"解析","points":2,"correct_bool":null,'
        '"source_page":1,"has_visual":false,"bbox":[0,0,1,1],'
        '"options":[{"label":"A","content_markdown":"选项","correct":true}],'
        '"programming":{"input_markdown":"","output_markdown":"","constraints_markdown":"",'
        '"starter_code":"","reference_solution":"","time_limit_ms":1000,"memory_limit_mb":128,'
        '"cases":[{"input_data":"","expected_output":"","is_sample":true,"weight":0,"note":""}]}}]}。'
        "bbox 使用相对页面坐标 0 到 1。识别答案表但不要把答案表写入题面；保留代码块。"
        "编程题隐藏用例只能作为未确认候选，is_sample=false，weight 可建议但不能标记确认。"
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": "请把这些连续试卷页面解析为结构化题库。" + schema}]
    for page in pages:
        content.append({"type": "text", "text": f"第 {page['number']} 页提取文本：\n{page['text']}"})
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(page["png"]).decode("ascii")}})
    async with httpx.AsyncClient(timeout=settings.import_llm_timeout_seconds) as client:
        response = await client.post(
            f"{settings.import_llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.import_llm_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.import_llm_model,
                "temperature": 0,
                "messages": [
                    {"role": "system", "content": "你是严谨的中文试卷数字化编辑，只输出合法 JSON。"},
                    {"role": "user", "content": content},
                ],
            },
        )
        response.raise_for_status()
        return _json_content(response.json()["choices"][0]["message"]["content"])


def _page_batches(pages: list[dict[str, Any]], batch_pages: int):
    size = max(1, min(8, batch_pages))
    overlap = 1 if size > 1 else 0
    step = size - overlap
    start = 0
    while start < len(pages):
        batch = pages[start:start + size]
        if not batch:
            break
        yield batch
        if start + size >= len(pages):
            break
        start += step


async def parse_pdf(settings: Settings, path: Path) -> tuple[Any, list[dict[str, Any]], dict[str, Any]]:
    document, pages = _extract_pages(path, settings)
    combined: dict[str, Any] = {"title": path.stem, "description": "", "questions": []}
    seen: dict[tuple[str, str], dict[str, Any]] = {}
    try:
        # One-page overlap keeps adjacent pages together when a programming
        # problem crosses a batch boundary. Duplicate questions are merged below.
        batches = list(_page_batches(pages, settings.import_llm_batch_pages))
        for batch_index, batch in enumerate(batches, start=1):
            logger.info(
                "PDF import model request %s/%s: file=%s pages=%s-%s page_count=%s",
                batch_index,
                len(batches),
                path.name,
                batch[0]["number"],
                batch[-1]["number"],
                len(batch),
            )
            payload = await _request_batch(settings, batch)
            if payload.get("title") and combined["title"] == path.stem:
                combined["title"] = str(payload["title"])[:180]
                combined["description"] = str(payload.get("description", ""))[:5000]
            for raw in payload.get("questions", []):
                kind = _question_type(raw.get("type"))
                number = str(raw.get("number", len(seen) + 1))
                key = (kind, number)
                previous = seen.get(key)
                if previous is None or len(str(raw.get("stem_markdown", ""))) > len(str(previous.get("stem_markdown", ""))):
                    seen[key] = raw
        combined["questions"] = list(seen.values())
        if not combined["questions"]:
            raise ValueError("没有识别到题目")
        return document, pages, combined
    except Exception:
        document.close()
        raise


def _save_crop(db: Session, settings: Settings, question_set_id: int, document: Any, raw: dict[str, Any], index: int) -> int | None:
    if not raw.get("has_visual") and not raw.get("bbox"):
        return None
    try:
        import pymupdf as fitz
        page_number = max(1, int(raw.get("source_page") or 1))
        page = document[page_number - 1]
        bbox = raw.get("bbox") or [0, 0, 1, 1]
        x0, y0, x1, y1 = [float(value) for value in bbox]
        rect = fitz.Rect(x0 * page.rect.width, y0 * page.rect.height, x1 * page.rect.width, y1 * page.rect.height)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.75, 1.75), clip=rect, alpha=False)
        data = pixmap.tobytes("png")
        key = f"question-{question_set_id}-{index}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}.png"
        root = Path(settings.question_asset_dir)
        root.mkdir(parents=True, exist_ok=True)
        (root / key).write_bytes(data)
        asset = QuestionAsset(question_set_id=question_set_id, storage_key=key, original_name=key, mime_type="image/png", kind="question", size_bytes=len(data))
        db.add(asset)
        db.flush()
        return asset.id
    except (ValueError, TypeError, IndexError):
        return None


def materialize_draft(db: Session, settings: Settings, source_asset: QuestionAsset, document: Any, payload: dict[str, Any]) -> QuestionSet:
    question_set = QuestionSet(
        title=str(payload.get("title") or source_asset.original_name)[:180],
        description=_safe_markdown(payload.get("description"), 5000),
        status="draft",
        source_pdf_asset_id=source_asset.id,
    )
    db.add(question_set)
    db.flush()
    source_asset.question_set_id = question_set.id
    for index, raw in enumerate(payload.get("questions", []), start=1):
        kind = _question_type(raw.get("type"))
        points = max(1, min(10000, int(raw.get("points") or (25 if kind == "programming" else 2))))
        question = Question(
            question_set_id=question_set.id,
            type=kind,
            stem_markdown=_safe_markdown(raw.get("stem_markdown")) or f"第 {index} 题",
            explanation_markdown=_safe_markdown(raw.get("explanation_markdown")),
            points=points,
            sort_order=index - 1,
            reviewed=False,
            correct_bool=raw.get("correct_bool") if kind == "true_false" else None,
            source_page=max(1, int(raw.get("source_page") or 1)),
            show_source_crop=bool(raw.get("has_visual")),
        )
        db.add(question)
        db.flush()
        question.source_asset_id = _save_crop(db, settings, question_set.id, document, raw, index)
        if kind in {"single_choice", "multiple_choice"}:
            for option_index, option in enumerate(raw.get("options") or []):
                question.options.append(QuestionOption(
                    label=str(option.get("label") or chr(65 + option_index))[:16],
                    content_markdown=_safe_markdown(option.get("content_markdown"), 10000) or "（待补充）",
                    correct=bool(option.get("correct")),
                    sort_order=option_index,
                ))
        elif kind == "programming":
            program = raw.get("programming") or {}
            spec = ProgrammingSpec(
                input_markdown=_safe_markdown(program.get("input_markdown"), 20000),
                output_markdown=_safe_markdown(program.get("output_markdown"), 20000),
                constraints_markdown=_safe_markdown(program.get("constraints_markdown"), 20000),
                starter_code=str(program.get("starter_code") or "")[:100000],
                reference_solution=str(program.get("reference_solution") or "")[:100000],
                time_limit_ms=max(100, min(settings.judge_max_time_ms, int(program.get("time_limit_ms") or settings.judge_default_time_ms))),
                memory_limit_mb=max(32, min(settings.judge_max_memory_mb, int(program.get("memory_limit_mb") or settings.judge_default_memory_mb))),
            )
            for case in program.get("cases") or []:
                is_sample = bool(case.get("is_sample"))
                spec.cases.append(ProgrammingCase(
                    input_data=str(case.get("input_data") or "")[:100000],
                    expected_output=str(case.get("expected_output") or "")[:100000] if is_sample else "",
                    is_sample=is_sample,
                    weight=0 if is_sample else max(0, int(case.get("weight") or 0)),
                    confirmed=False,
                    note=_safe_markdown(case.get("note"), 1000),
                ))
            question.programming = spec
    return question_set


def _claim_job(session_factory: Callable[[], Session]) -> int | None:
    now = datetime.utcnow()
    stale = now - timedelta(minutes=15)
    with session_factory() as db:
        db.execute(update(QuestionImportJob).where(
            QuestionImportJob.status == "processing",
            QuestionImportJob.processing_started_at < stale,
        ).values(status="pending", processing_started_at=None))
        job = db.scalar(select(QuestionImportJob).where(
            QuestionImportJob.status == "pending",
            or_(QuestionImportJob.processing_started_at.is_(None), QuestionImportJob.processing_started_at <= now),
        ).order_by(QuestionImportJob.id).limit(1))
        if not job:
            db.commit()
            return None
        job.status = "processing"
        job.processing_started_at = now
        job.attempts += 1
        job.error = ""
        db.commit()
        return job.id


async def _process_job(session_factory: Callable[[], Session], settings: Settings, job_id: int) -> None:
    document = None
    try:
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            asset = db.get(QuestionAsset, job.source_asset_id) if job else None
            if not job or not asset:
                return
            path = Path(settings.question_asset_dir) / asset.storage_key
            asset_id = asset.id
        logger.info(
            "PDF import job %s started: model=%s base_url=%s file=%s",
            job_id,
            settings.import_llm_model,
            settings.import_llm_base_url,
            path.name,
        )
        document, pages, payload = await parse_pdf(settings, path)
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            asset = db.get(QuestionAsset, asset_id)
            if not job or not asset:
                return
            question_set = materialize_draft(db, settings, asset, document, payload)
            job.question_set_id = question_set.id
            job.page_count = len(pages)
            job.status = "ready"
            job.processing_started_at = None
            db.commit()
            logger.info(
                "PDF import job %s completed: pages=%s questions=%s question_set_id=%s",
                job_id,
                len(pages),
                len(payload.get("questions", [])),
                question_set.id,
            )
    except Exception as exc:
        error_detail = _import_error_detail(exc)
        final_status = "pending"
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            if job:
                job.error = error_detail
                job.status = "failed" if job.attempts >= settings.import_llm_max_retries else "pending"
                job.processing_started_at = None if job.status == "failed" else datetime.utcnow() + timedelta(seconds=min(300, 2 ** job.attempts))
                final_status = job.status
                db.commit()
        logger.error(
            "PDF import job %s %s after processing error: %s",
            job_id,
            "failed" if final_status == "failed" else "will retry",
            error_detail,
            exc_info=True,
        )
    finally:
        if document is not None:
            document.close()


async def question_import_worker(session_factory: Callable[[], Session], settings: Settings) -> None:
    while True:
        if not import_llm_configured(settings):
            await asyncio.sleep(5)
            continue
        job_id = _claim_job(session_factory)
        if job_id is None:
            await asyncio.sleep(1)
            continue
        await _process_job(session_factory, settings, job_id)
