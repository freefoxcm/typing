import asyncio
import base64
import html
import json
import logging
import re
from copy import deepcopy
from datetime import datetime, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .job_control import progress_payload, register_active_job, unregister_active_job
from .models import ProgrammingCase, ProgrammingSpec, Question, QuestionAsset, QuestionBlank, QuestionImportJob, QuestionOption, QuestionSet


logger = logging.getLogger("uvicorn.error")
ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit_progress(
    callback: ProgressCallback | None,
    phase: str,
    label: str,
    percent: int,
    *,
    current: int | None = None,
    total: int | None = None,
    unit: str | None = None,
    detail: str = "",
) -> None:
    if callback:
        await callback(progress_payload(phase, label, percent, current=current, total=total, unit=unit, detail=detail))


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
    text = re.sub(r"<think>.*?</think>", "", content.strip(), flags=re.DOTALL | re.IGNORECASE).strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    decoder = json.JSONDecoder(strict=False)
    errors: list[json.JSONDecodeError] = []
    for match in re.finditer(r"\{", text):
        try:
            payload, _ = decoder.raw_decode(text, match.start())
        except json.JSONDecodeError as exc:
            errors.append(exc)
            continue
        if isinstance(payload, dict) and isinstance(payload.get("questions"), list):
            return payload

    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end >= start:
        candidate = text[start:end + 1]
        # Models occasionally emit JavaScript-style trailing commas. This is a
        # conservative repair that does not alter question text or answers.
        repaired = re.sub(r",\s*([}\]])", r"\1", candidate)
        if repaired != candidate:
            try:
                payload = json.loads(repaired, strict=False)
                if isinstance(payload, dict) and isinstance(payload.get("questions"), list):
                    return payload
            except json.JSONDecodeError as exc:
                errors.append(exc)
    if not errors:
        raise ValueError("识别模型未返回 JSON 对象")
    error = max(errors, key=lambda item: item.pos)
    context = text[max(0, error.pos - 120):error.pos + 120].replace("\n", "\\n")
    raise ValueError(
        f"识别模型返回无效 JSON：{error.msg}，第 {error.lineno} 行第 {error.colno} 列；"
        f"响应片段：{context}"
    ) from error


def _safe_markdown(value: Any, limit: int = 50000) -> str:
    text = str(value or "").strip()[:limit]
    # React renders this content as text and the Markdown component never uses
    # raw HTML, so storing entities here only makes comparison operators appear
    # as literal "&lt;" / "&gt;" text. Decode one model-produced entity layer.
    return html.unescape(text)


def _question_type(value: Any) -> str:
    text = str(value or "").strip().lower()
    aliases = {
        "single": "single_choice", "single_choice": "single_choice", "单选": "single_choice", "单选题": "single_choice",
        "multiple": "multiple_choice", "multiple_choice": "multiple_choice", "多选": "multiple_choice", "多选题": "multiple_choice",
        "true_false": "true_false", "judgment": "true_false", "判断": "true_false", "判断题": "true_false",
        "fill_blank": "fill_blank", "blank": "fill_blank", "填空": "fill_blank", "填空题": "fill_blank",
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
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        pages.append({
            "number": index + 1,
            "text": page.get_text("text")[:30000],
            "png": pixmap.tobytes("png"),
            "width": page.rect.width,
            "height": page.rect.height,
        })
    return document, pages


async def _request_batch(
    settings: Settings,
    pages: list[dict[str, Any]],
    primary_pages: list[int] | None = None,
) -> dict[str, Any]:
    primary_pages = primary_pages or [int(page["number"]) for page in pages]
    schema = (
        '只返回 JSON：{"title":"题套标题","description":"说明",'
        '"page_inventory":[{"source_page":1,"questions":[{"candidate_id":"p1-q1",'
        '"number":"1","section":"一、选择题","type":"single_choice"}]}],"questions":[{'
        '"candidate_id":"p1-q1","number":"1","section":"一、选择题",'
        '"type":"single_choice|multiple_choice|true_false|fill_blank|programming",'
        '"stem_markdown":"题面","explanation_markdown":"解析","points":2,"correct_bool":null,'
        '"source_page":1,"source_end_page":1,"complete":true,"has_visual":false,"bbox":[0.08,0.12,0.92,0.36],'
        '"crop_regions":[{"source_page":1,"bbox":[0.08,0.12,0.92,0.36]}],'
        '"confidence":{"stem":0.95,"answer":0.95,"crop":0.95},'
        '"options":[{"label":"A","content_markdown":"选项","correct":true}],'
        '"blanks":[{"position":1,"accepted_answers":["答案","等价答案"]}],'
        '"programming":{"input_markdown":"","output_markdown":"","constraints_markdown":"",'
        '"starter_code":"","reference_solution":"","time_limit_ms":1000,"memory_limit_mb":128,'
        '"cases":[{"input_data":"","expected_output":"","is_sample":true,"weight":0,"note":""}]}}]}。'
        f"本次仅输出起始页为 {primary_pages} 的题目；其他页只是上下文，不得单独输出其上开始的题。"
        "page_inventory 必须逐个列出主页面上开始的题目，并与 questions 使用相同 candidate_id。"
        "一道编程题的题面、小问、代码、样例和续页必须合并为同一题，除非试卷明确印有新题号和独立分值。"
        "题目被截断或续页不足时 complete=false，source_end_page 是实际覆盖的最后页。"
        "bbox 使用起始页的相对坐标 0 到 1。识别答案表但不要把答案表写入题面；保留代码块和原始缩进。"
        "填空题将每个印刷空格在题面中写成连续的 {{1}}、{{2}}，blanks 与占位符一一对应。"
        "判断题的 correct_bool 必须根据答案明确返回 true 或 false，不得返回 null；单选题必须且只能标记一个正确选项，多选题至少标记一个正确选项。"
        "每一道题无论 has_visual 是否为 true，都必须返回 crop_regions，且只覆盖该题的完整题面、选项、代码和样例；跨页题逐页返回裁剪区域。"
        "编程题隐藏用例只能作为未确认候选，is_sample=false，weight 可建议但不能标记确认。"
        "必须使用标准 JSON：所有属性名和字符串使用英文双引号，字符串内换行和反斜杠必须转义，禁止尾逗号、注释和省略号。"
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": "请把这些连续试卷页面解析为结构化题库。" + schema}]
    for page in pages:
        content.append({"type": "text", "text": f"第 {page['number']} 页提取文本：\n{page['text']}"})
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(page["png"]).decode("ascii")}})
    endpoint = f"{settings.import_llm_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.import_llm_api_key}", "Content-Type": "application/json"}
    request_body = _model_request_body(settings, [
            {"role": "system", "content": "你是严谨的中文试卷数字化编辑。只能输出一个语法严格合法的 JSON 对象，不要解释，不要使用 Markdown 代码围栏。"},
            {"role": "user", "content": content},
        ])
    async with httpx.AsyncClient(timeout=settings.import_llm_timeout_seconds) as client:
        response = await client.post(endpoint, headers=headers, json=request_body)
        response.raise_for_status()
        choice = response.json()["choices"][0]
        raw_content = str(choice["message"].get("content") or "")
        if choice.get("finish_reason") == "length":
            raise ValueError("识别模型输出因长度限制被截断，请降低 IMPORT_LLM_BATCH_PAGES 后重试")
        try:
            return _json_content(raw_content)
        except ValueError as original_error:
            logger.warning(
                "PDF import model returned invalid JSON; attempting one repair request: %s",
                original_error,
            )
            repair_body = _model_request_body(settings, [
                    {
                        "role": "system",
                        "content": (
                            "你是 JSON 语法修复器。修复用户提供的 JSON，使其能被标准 JSON 解析器读取。"
                            "不得增删题目或改变字段值；所有属性名和字符串使用英文双引号；正确转义换行和反斜杠；"
                            "删除尾逗号。只输出修复后的 JSON 对象，不要解释或使用 Markdown。"
                        ),
                    },
                    {"role": "user", "content": raw_content},
                ])
            repair_response = await client.post(endpoint, headers=headers, json=repair_body)
            repair_response.raise_for_status()
            repair_choice = repair_response.json()["choices"][0]
            if repair_choice.get("finish_reason") == "length":
                raise ValueError("JSON 自动修复输出因长度限制被截断，请降低 IMPORT_LLM_BATCH_PAGES 后重试") from original_error
            repaired_content = str(repair_choice["message"].get("content") or "")
            try:
                return _json_content(repaired_content)
            except ValueError as repair_error:
                raise ValueError(
                    f"识别模型返回无效 JSON，自动修复仍失败。原始错误：{original_error}；修复错误：{repair_error}"
                ) from repair_error


def _model_request_body(settings: Settings, messages: list[dict[str, Any]]) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": settings.import_llm_model,
        "temperature": 0,
        "messages": messages,
    }
    effort = settings.import_llm_reasoning_effort.strip()
    if effort:
        body["reasoning_effort"] = effort
    elif settings.import_llm_model.strip().lower() == "minimax-m3":
        body["thinking"] = {"type": "disabled"}
    return body


async def _request_reconciliation(settings: Settings, candidates: list[dict[str, Any]]) -> dict[str, Any]:
    metadata = []
    for raw in candidates:
        metadata.append({
            "candidate_id": raw["_candidate_id"],
            "number": str(raw.get("number") or ""),
            "section": str(raw.get("section") or ""),
            "type": _question_type(raw.get("type")),
            "source_page": raw.get("source_page"),
            "source_end_page": raw.get("source_end_page"),
            "complete": raw.get("complete", True),
            "stem_excerpt": str(raw.get("stem_markdown") or "")[:240],
        })
    prompt = (
        "你是试卷题目结构校对器。只根据候选元数据判断哪些候选是同一道印刷题的重复或跨页片段。"
        "不得合并不同章节中恰好同号的题，不得新增题目或改写题面。"
        '只返回标准 JSON：{"questions":[],"groups":[{"candidate_ids":["c1","c2"],"reason":"跨页续题"}],'
        '"warnings":["疑似缺少第 3 题"]}。不需合并的候选不要出现在 groups 中。\n'
        + json.dumps(metadata, ensure_ascii=False)
    )
    endpoint = f"{settings.import_llm_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.import_llm_api_key}", "Content-Type": "application/json"}
    body = _model_request_body(settings, [
        {"role": "system", "content": "只输出一个严格 JSON 对象，不要解释。"},
        {"role": "user", "content": prompt},
    ])
    async with httpx.AsyncClient(timeout=settings.import_llm_timeout_seconds) as client:
        response = await client.post(endpoint, headers=headers, json=body)
        response.raise_for_status()
    return _json_content(str(response.json()["choices"][0]["message"].get("content") or ""))


def _normalize_key_part(value: Any) -> str:
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", str(value or "").lower())


def _integer(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        match = re.search(r"\d+", str(value or ""))
        return int(match.group()) if match else default


def _positive_int(value: Any, default: int = 1) -> int:
    return max(1, _integer(value, default))


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    return max(minimum, min(maximum, _integer(value, default)))


def _boolean_value(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and value in {0, 1}:
        return bool(value)
    text = str(value or "").strip().lower()
    if text in {"true", "1", "yes", "正确", "对", "是"}:
        return True
    if text in {"false", "0", "no", "错误", "错", "否"}:
        return False
    return None


def _mapping_items(value: Any) -> list[dict[str, Any]]:
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def candidate_validation_errors(raw: dict[str, Any]) -> list[str]:
    """Return actionable semantic errors without trusting the model's shapes."""
    errors: list[str] = []
    kind = _question_type(raw.get("type"))
    if not _safe_markdown(raw.get("stem_markdown")):
        errors.append("缺少题面")
    if _integer(raw.get("source_page"), 0) < 1:
        errors.append("来源页无效")
    if raw.get("points") is not None and raw.get("points") != "":
        try:
            if int(raw.get("points")) < 1:
                errors.append("分值必须大于 0")
        except (TypeError, ValueError):
            errors.append("分值不是有效整数")

    if kind in {"single_choice", "multiple_choice"}:
        raw_options = raw.get("options")
        options = _mapping_items(raw_options)
        if not isinstance(raw_options, list) or len(options) != len(raw_options):
            errors.append("选项结构无效")
        if len(options) < 2:
            errors.append("选择题至少需要两个选项")
        correct_count = sum(_boolean_value(item.get("correct")) is True for item in options)
        if kind == "single_choice" and correct_count != 1:
            errors.append("单选题必须且只能有一个正确选项")
        if kind == "multiple_choice" and correct_count < 1:
            errors.append("多选题至少需要一个正确选项")
    elif kind == "true_false":
        if _boolean_value(raw.get("correct_bool")) is None:
            errors.append("判断题缺少明确的正确答案")
    elif kind == "fill_blank":
        raw_blanks = raw.get("blanks")
        blanks = _mapping_items(raw_blanks)
        if not isinstance(raw_blanks, list) or len(blanks) != len(raw_blanks):
            errors.append("填空答案结构无效")
        markers = [int(item) for item in re.findall(r"\{\{(\d+)\}\}", str(raw.get("stem_markdown") or ""))]
        positions = [_positive_int(item.get("position"), index) for index, item in enumerate(blanks, start=1)]
        if not blanks or markers != list(range(1, len(blanks) + 1)) or positions != list(range(1, len(blanks) + 1)):
            errors.append("填空占位符与答案不一致")
        if any(not isinstance(item.get("accepted_answers"), list) or not any(str(value).strip() for value in item.get("accepted_answers")) for item in blanks):
            errors.append("填空题存在空的可接受答案")
    elif kind == "programming":
        program = raw.get("programming")
        if not isinstance(program, dict):
            errors.append("编程题缺少有效的编程规格")
        else:
            cases = program.get("cases", [])
            if not isinstance(cases, list) or len(_mapping_items(cases)) != len(cases):
                errors.append("编程测试点结构无效")
    return list(dict.fromkeys(errors))


def _question_key(raw: dict[str, Any]) -> tuple[str, str, int]:
    page = _positive_int(raw.get("source_page"), 1)
    section = _normalize_key_part(raw.get("section"))
    number = _normalize_key_part(raw.get("number"))
    if not section:
        # Printed numbers commonly restart in each section. When the model omits
        # the section, include a stem fingerprint instead of risking an unsafe
        # merge of two unrelated "question 1" entries on the same page.
        section = "missing" + _normalize_key_part(str(raw.get("stem_markdown") or "")[:40])
    if not number:
        number = _normalize_key_part(str(raw.get("stem_markdown") or "")[:80])
    return section, number, page


def _candidate_score(raw: dict[str, Any]) -> int:
    program = raw.get("programming") if isinstance(raw.get("programming"), dict) else {}
    options = raw.get("options") if isinstance(raw.get("options"), list) else []
    blanks = raw.get("blanks") if isinstance(raw.get("blanks"), list) else []
    return (
        (100000 if raw.get("complete", True) else 0)
        + len(str(raw.get("stem_markdown") or ""))
        + len(str(raw.get("explanation_markdown") or ""))
        + len(json.dumps(program, ensure_ascii=False))
        + len(options) * 100
        + len(blanks) * 100
    )


def _confidence_value(raw: dict[str, Any]) -> float | None:
    value = raw.get("confidence")
    if isinstance(value, dict):
        values = []
        for item in value.values():
            try:
                values.append(float(item))
            except (TypeError, ValueError):
                pass
        return max(0.0, min(1.0, min(values))) if values else None
    try:
        return max(0.0, min(1.0, float(value))) if value is not None else None
    except (TypeError, ValueError):
        return None


def _crop_is_suspicious(raw: dict[str, Any]) -> bool:
    regions = raw.get("crop_regions") or [{"source_page": raw.get("source_page"), "bbox": raw.get("bbox")}]
    if not isinstance(regions, list) or not regions:
        return True
    for region in regions:
        bbox = region.get("bbox") if isinstance(region, dict) else None
        if not isinstance(bbox, list) or len(bbox) != 4:
            return True
        try:
            x0, y0, x1, y1 = [float(item) for item in bbox]
        except (TypeError, ValueError):
            return True
        width, height = x1 - x0, y1 - y0
        if (
            x0 < 0 or y0 < 0 or x1 > 1 or y1 > 1 or x1 <= x0 or y1 <= y0
            or width * height < .005 or width < .02 or height < .02
            or width * height >= .85
            or x0 <= .01 and y0 <= .01 and x1 >= .99 and y1 >= .99
        ):
            return True
    return False


def _recognition_text(raw: dict[str, Any]) -> str:
    values = [str(raw.get("number") or ""), str(raw.get("stem_markdown") or "")]
    values.extend(str(item.get("content_markdown") or "") for item in raw.get("options") or [] if isinstance(item, dict))
    program = raw.get("programming") if isinstance(raw.get("programming"), dict) else {}
    values.extend(str(program.get(key) or "") for key in ("input_markdown", "output_markdown", "constraints_markdown"))
    return _normalize_key_part(" ".join(values))


def _page_blocks(page: Any) -> list[tuple[float, float, float, float, str]]:
    return [
        (float(x0), float(y0), float(x1), float(y1), _normalize_key_part(text))
        for x0, y0, x1, y1, text, *_ in page.get_text("blocks")
        if _normalize_key_part(text)
    ]


def _locate_question_top(page: Any, raw: dict[str, Any]) -> tuple[float, float] | None:
    needle = _recognition_text(raw)
    if not needle:
        return None
    best: tuple[float, tuple[float, float]] | None = None
    for x0, y0, x1, y1, text in _page_blocks(page):
        exact = next((size for size in range(min(32, len(needle), len(text)), 7, -1) if needle[:size] in text or text[:size] in needle), 0)
        score = 1.0 if exact >= 12 else SequenceMatcher(None, needle[:120], text[:240]).ratio()
        if best is None or score > best[0]:
            best = (score, (y0, y1))
    return best[1] if best and best[0] >= .28 else None


def repair_crop_regions(document: Any, questions: list[dict[str, Any]]) -> None:
    """Replace suspicious model crops with deterministic PDF text-layer bounds."""
    starts: dict[int, list[tuple[float, dict[str, Any]]]] = {}
    for raw in questions:
        page_number = _positive_int(raw.get("source_page"), 1)
        if page_number > document.page_count:
            continue
        located = _locate_question_top(document[page_number - 1], raw)
        if located:
            starts.setdefault(page_number, []).append((located[0], raw))
    for values in starts.values():
        values.sort(key=lambda item: item[0])

    for raw in questions:
        if not _crop_is_suspicious(raw):
            continue
        start = _positive_int(raw.get("source_page"), 1)
        end = min(document.page_count, max(start, _positive_int(raw.get("source_end_page"), start)))
        if start > document.page_count:
            continue
        located = _locate_question_top(document[start - 1], raw)
        if not located:
            raw.setdefault("_recognition_warnings", []).append("模型裁剪区域异常，且无法通过 PDF 文本层可靠定位")
            continue
        regions: list[dict[str, Any]] = []
        for page_number in range(start, end + 1):
            page = document[page_number - 1]
            blocks = _page_blocks(page)
            if not blocks:
                continue
            content_top = min(item[1] for item in blocks)
            content_bottom = max(item[3] for item in blocks)
            top = located[0] if page_number == start else content_top
            bottom = content_bottom
            if page_number == start:
                later = [value for value, item in starts.get(page_number, []) if value > top + 1 and item is not raw]
                if later:
                    bottom = min(later)
            overlapping = [item for item in blocks if item[3] >= top and item[1] <= bottom]
            if not overlapping or bottom <= top:
                continue
            x0 = min(item[0] for item in overlapping) / page.rect.width
            x1 = max(item[2] for item in overlapping) / page.rect.width
            regions.append({"source_page": page_number, "bbox": [x0, top / page.rect.height, x1, bottom / page.rect.height]})
        if regions:
            raw["crop_regions"] = regions
            raw["bbox"] = regions[0]["bbox"]
            raw.setdefault("_recognition_warnings", []).append("模型裁剪区域异常，已使用 PDF 文本层重新定位")


def _needs_focused_review(raw: dict[str, Any]) -> bool:
    kind = _question_type(raw.get("type"))
    confidence = _confidence_value(raw)
    stem = str(raw.get("stem_markdown") or "")
    return bool(
        kind in {"fill_blank", "programming"}
        or raw.get("has_visual")
        or not raw.get("complete", True)
        or _positive_int(raw.get("source_end_page"), 1) > _positive_int(raw.get("source_page"), 1)
        or confidence is not None and confidence < .9
        or _crop_is_suspicious(raw)
        or candidate_validation_errors(raw)
        or "```" in stem or "$" in stem
    )


async def _request_focused_review(settings: Settings, document: Any, raw: dict[str, Any], allow_type_change: bool = False) -> dict[str, Any]:
    start = _positive_int(raw.get("source_page"), 1)
    end = min(document.page_count, max(start, _positive_int(raw.get("source_end_page"), start)))
    content: list[dict[str, Any]] = [{
        "type": "text",
        "text": (
            "请对照高清原页复核这一道题。纠正题面、选项、答案、填空占位符、代码缩进和跨页范围，"
            "并重新给出覆盖完整题目的逐页 crop_regions。不得新增题目。只返回与原结构相同、questions 仅含一道题的严格 JSON。\n"
            + json.dumps({"questions": [raw]}, ensure_ascii=False, default=str)
        ),
    }]
    import pymupdf as fitz
    for page_number in range(start, end + 1):
        page = document[page_number - 1]
        pixmap = page.get_pixmap(matrix=fitz.Matrix(3, 3), alpha=False)
        content.append({"type": "text", "text": f"第 {page_number} 页高清原图"})
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(pixmap.tobytes("png")).decode("ascii")}})
    endpoint = f"{settings.import_llm_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.import_llm_api_key}", "Content-Type": "application/json"}
    body = _model_request_body(settings, [
        {"role": "system", "content": "你是严谨的试卷逐题校对员，只输出一个严格 JSON 对象。"},
        {"role": "user", "content": content},
    ])
    async with httpx.AsyncClient(timeout=settings.import_llm_timeout_seconds) as client:
        response = await client.post(endpoint, headers=headers, json=body)
        response.raise_for_status()
    payload = _json_content(str(response.json()["choices"][0]["message"].get("content") or ""))
    questions = payload.get("questions") or []
    if len(questions) != 1 or not isinstance(questions[0], dict):
        raise ValueError("单题高清复核未返回唯一题目")
    reviewed = questions[0]
    if not allow_type_change and _question_type(reviewed.get("type")) != _question_type(raw.get("type")):
        raise ValueError("单题高清复核改变了题型")
    if not str(reviewed.get("stem_markdown") or "").strip():
        raise ValueError("单题高清复核返回的题面无效")
    kind = _question_type(reviewed.get("type"))
    if kind in {"single_choice", "multiple_choice"} and len(reviewed.get("options") or []) < 2:
        raise ValueError("单题高清复核缺少选择题选项")
    if kind == "fill_blank":
        markers = re.findall(r"\{\{\d+\}\}", str(reviewed.get("stem_markdown") or ""))
        if not markers or len(markers) != len(reviewed.get("blanks") or []):
            raise ValueError("单题高清复核的填空占位符与答案不一致")
    if kind == "programming" and not isinstance(reviewed.get("programming"), dict):
        raise ValueError("单题高清复核缺少编程题规格")
    reviewed["_candidate_id"] = raw.get("_candidate_id")
    return reviewed


def _merge_question_group(group: list[dict[str, Any]]) -> dict[str, Any]:
    ordered = sorted(group, key=_candidate_score, reverse=True)
    result = deepcopy(ordered[0])
    result["source_page"] = min(_positive_int(item.get("source_page"), 1) for item in group)
    result["source_end_page"] = max(_positive_int(item.get("source_end_page"), _positive_int(item.get("source_page"), 1)) for item in group)
    result["complete"] = any(item.get("complete", True) for item in group)
    result["_merged_candidate_ids"] = [item["_candidate_id"] for item in group]
    if _question_type(result.get("type")) in {"single_choice", "multiple_choice"}:
        result["options"] = max(
            (item.get("options") for item in group if isinstance(item.get("options"), list)),
            key=len,
            default=[],
        )
    if _question_type(result.get("type")) == "fill_blank":
        result["blanks"] = max(
            (item.get("blanks") for item in group if isinstance(item.get("blanks"), list)),
            key=len,
            default=[],
        )
    if _question_type(result.get("type")) == "programming":
        programs = [item.get("programming") for item in ordered if isinstance(item.get("programming"), dict)]
        if programs:
            program = deepcopy(max(programs, key=lambda item: len(json.dumps(item, ensure_ascii=False))))
            for candidate in programs:
                for field in ("input_markdown", "output_markdown", "constraints_markdown", "starter_code", "reference_solution"):
                    if not str(program.get(field) or "").strip() and str(candidate.get(field) or "").strip():
                        program[field] = candidate[field]
            cases: dict[tuple[bool, str], dict[str, Any]] = {}
            for candidate in programs:
                for case in candidate.get("cases") or []:
                    if not isinstance(case, dict):
                        continue
                    key = (bool(case.get("is_sample")), str(case.get("input_data") or "").strip())
                    previous = cases.get(key)
                    if previous is None or len(str(case.get("expected_output") or "")) > len(str(previous.get("expected_output") or "")):
                        cases[key] = deepcopy(case)
            program["cases"] = list(cases.values())
            result["programming"] = program
    return result


def _merge_candidates(
    candidates: list[dict[str, Any]],
    reconciliation: dict[str, Any] | None,
) -> tuple[list[dict[str, Any]], list[str], int]:
    parent = {item["_candidate_id"]: item["_candidate_id"] for item in candidates}

    def find(value: str) -> str:
        while parent[value] != value:
            parent[value] = parent[parent[value]]
            value = parent[value]
        return value

    def union(values: list[str]) -> None:
        valid = [value for value in values if value in parent]
        if len(valid) < 2:
            return
        root = find(valid[0])
        for value in valid[1:]:
            parent[find(value)] = root

    local_groups: dict[tuple[str, str, int], list[str]] = {}
    for item in candidates:
        local_groups.setdefault(_question_key(item), []).append(item["_candidate_id"])
    for values in local_groups.values():
        union(values)
    rejected_groups = 0
    if reconciliation:
        for group in reconciliation.get("groups") or []:
            if isinstance(group, dict):
                values = [str(value) for value in group.get("candidate_ids") or []]
                members = [item for item in candidates if item["_candidate_id"] in values]
                sections = {_normalize_key_part(item.get("section")) for item in members if _normalize_key_part(item.get("section"))}
                numbers = {_normalize_key_part(item.get("number")) for item in members if _normalize_key_part(item.get("number"))}
                number_roots = {match.group() for value in numbers if (match := re.match(r"\d+", value))}
                number_conflict = len(numbers) > 1 and (not number_roots or len(number_roots) > 1)
                if len(sections) > 1 or number_conflict:
                    rejected_groups += 1
                    continue
                union(values)

    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in candidates:
        grouped.setdefault(find(item["_candidate_id"]), []).append(item)
    merged = [_merge_question_group(group) for group in grouped.values()]
    merged.sort(key=lambda item: (
        int(item.get("source_page") or 1),
        float((item.get("bbox") or [0, 0, 1, 1])[1]) if str((item.get("bbox") or [0, 0, 1, 1])[1]).replace(".", "", 1).isdigit() else 0,
        _normalize_key_part(item.get("number")),
    ))
    merged_count = sum(max(0, len(group) - 1) for group in grouped.values())
    warnings = []
    if reconciliation:
        warnings.extend(str(item) for item in reconciliation.get("warnings") or [] if str(item).strip())
    if merged_count:
        warnings.append(f"已合并 {merged_count} 个重复或跨页题目候选")
    if rejected_groups:
        warnings.append(f"已拒绝 {rejected_groups} 组跨章节或题号冲突的自动合并建议")
    return merged, warnings, merged_count


def _inventory_count(payload: dict[str, Any], page_number: int) -> int | None:
    entries = payload.get("page_inventory")
    if not isinstance(entries, list):
        return None
    for entry in entries:
        if isinstance(entry, dict) and _integer(entry.get("source_page"), 0) == page_number:
            questions = entry.get("questions")
            return len(questions) if isinstance(questions, list) else 0
    return 0


def _numbering_anomalies(candidates: list[dict[str, Any]]) -> tuple[set[int], list[str]]:
    sections: dict[str, list[tuple[int, int]]] = {}
    labels: dict[str, str] = {}
    for raw in candidates:
        section = _normalize_key_part(raw.get("section"))
        number_text = str(raw.get("number") or "").strip()
        if not section or not number_text.isdigit():
            continue
        sections.setdefault(section, []).append((int(number_text), _positive_int(raw.get("source_page"), 1)))
        labels[section] = str(raw.get("section") or section)
    retry_pages: set[int] = set()
    warnings: list[str] = []
    for section, values in sections.items():
        unique = sorted(set(values))
        if len(unique) < 3:
            continue
        for previous, current in zip(unique, unique[1:]):
            gap = current[0] - previous[0]
            if 1 < gap <= 10:
                retry_pages.update({previous[1], current[1]})
                missing = "、".join(str(number) for number in range(previous[0] + 1, current[0]))
                warnings.append(f"{labels[section]} 疑似缺少题号 {missing}，已定向重试相关页")
    return retry_pages, warnings


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


async def parse_pdf(
    settings: Settings,
    path: Path,
    progress_callback: ProgressCallback | None = None,
) -> tuple[Any, list[dict[str, Any]], dict[str, Any]]:
    await _emit_progress(progress_callback, "reading_pdf", "正在读取 PDF", 5, detail="正在解析页面与文本层")
    document, pages = _extract_pages(path, settings)
    await _emit_progress(
        progress_callback,
        "reading_pdf",
        "PDF 读取完成",
        9,
        current=len(pages),
        total=len(pages),
        unit="page",
        detail=f"共 {len(pages)} 页，准备分批识别",
    )
    combined: dict[str, Any] = {"title": path.stem, "description": "", "questions": []}
    candidates: list[dict[str, Any]] = []
    warnings: list[str] = []
    retried_pages: set[int] = set()
    expected_by_page: dict[int, int] = {}
    try:
        # The last page of every non-final batch is look-ahead context. It becomes
        # a primary page in the next batch, so each printed question has one owner
        # while questions crossing a boundary can still see their continuation.
        batches = list(_page_batches(pages, settings.import_llm_batch_pages))
        for batch_index, batch in enumerate(batches, start=1):
            is_last = batch_index == len(batches)
            primary = batch if is_last or len(batch) == 1 else batch[:-1]
            primary_numbers = [int(page["number"]) for page in primary]
            logger.info(
                "PDF import model request %s/%s: file=%s pages=%s-%s primary=%s page_count=%s",
                batch_index,
                len(batches),
                path.name,
                batch[0]["number"],
                batch[-1]["number"],
                primary_numbers,
                len(batch),
            )
            await _emit_progress(
                progress_callback,
                "batch_recognition",
                "正在批量识别",
                10 + int(35 * (batch_index - 1) / max(1, len(batches))),
                current=batch_index,
                total=len(batches),
                unit="batch",
                detail=f"正在等待模型返回第 {batch_index}/{len(batches)} 批（第 {batch[0]['number']}-{batch[-1]['number']} 页）",
            )
            payload = await _request_batch(settings, batch, primary_numbers)
            if payload.get("title") and combined["title"] == path.stem:
                combined["title"] = str(payload["title"])[:180]
                combined["description"] = str(payload.get("description", ""))[:5000]
            batch_candidates: list[dict[str, Any]] = []
            for candidate_index, value in enumerate(payload.get("questions") or [], start=1):
                if not isinstance(value, dict):
                    continue
                raw = deepcopy(value)
                try:
                    source_page = max(1, int(raw.get("source_page") or primary_numbers[0]))
                except (TypeError, ValueError):
                    source_page = primary_numbers[0]
                if source_page not in primary_numbers:
                    warnings.append(f"已忽略上下文页 {source_page} 上重复输出的题目")
                    continue
                raw["source_page"] = source_page
                raw["source_end_page"] = max(source_page, _positive_int(raw.get("source_end_page"), source_page))
                raw["_candidate_id"] = f"b{batch_index}-q{candidate_index}"
                batch_candidates.append(raw)
            candidates.extend(batch_candidates)
            for page_number in primary_numbers:
                expected = _inventory_count(payload, page_number)
                if expected is None:
                    warnings.append(f"第 {page_number} 页未返回题目清单，需要人工核对")
                    continue
                expected_by_page[page_number] = expected
                actual = sum(int(item.get("source_page") or 0) == page_number for item in batch_candidates)
                if actual != expected:
                    retried_pages.add(page_number)
            for raw in batch_candidates:
                if not raw.get("complete", True):
                    retried_pages.add(int(raw["source_page"]))

            await _emit_progress(
                progress_callback,
                "batch_recognition",
                "正在批量识别",
                10 + int(35 * batch_index / max(1, len(batches))),
                current=batch_index,
                total=len(batches),
                unit="batch",
                detail=f"第 {batch_index}/{len(batches)} 批识别完成",
            )

        numbering_pages, numbering_warnings = _numbering_anomalies(candidates)
        retried_pages.update(numbering_pages)
        warnings.extend(numbering_warnings)

        # Retry only pages whose inventory count disagrees or whose question was
        # marked incomplete. Include one previous and two following pages so a
        # long programming statement can be reconstructed without a huge request.
        for retry_index, page_number in enumerate(sorted(retried_pages), start=1):
            focus = [page for page in pages if page_number - 1 <= int(page["number"]) <= page_number + 2]
            logger.info("PDF import focused retry %s: file=%s primary=%s context=%s", retry_index, path.name, page_number, [page["number"] for page in focus])
            await _emit_progress(
                progress_callback,
                "page_retry",
                "正在修复异常页面",
                45 + int(15 * (retry_index - 1) / max(1, len(retried_pages))),
                current=retry_index,
                total=len(retried_pages),
                unit="page",
                detail=f"正在等待模型重新识别第 {page_number} 页",
            )
            payload = await _request_batch(settings, focus, [page_number])
            added = 0
            for candidate_index, value in enumerate(payload.get("questions") or [], start=1):
                if not isinstance(value, dict):
                    continue
                raw = deepcopy(value)
                try:
                    source_page = max(1, int(raw.get("source_page") or page_number))
                except (TypeError, ValueError):
                    source_page = page_number
                if source_page != page_number:
                    continue
                raw["source_page"] = source_page
                raw["source_end_page"] = max(source_page, _positive_int(raw.get("source_end_page"), source_page))
                raw["_candidate_id"] = f"r{retry_index}-q{candidate_index}"
                candidates.append(raw)
                added += 1
            if not added:
                warnings.append(f"第 {page_number} 页定向重试仍未识别到题目")

        await _emit_progress(
            progress_callback,
            "page_retry",
            "页面修复完成",
            60,
            current=len(retried_pages),
            total=len(retried_pages),
            unit="page",
            detail=f"已处理 {len(retried_pages)} 个需要重试的页面" if retried_pages else "没有需要重试的页面",
        )

        reconciliation: dict[str, Any] | None = None
        await _emit_progress(progress_callback, "merging", "正在合并题目", 62, detail="正在校对重复题与跨页题")
        if len(candidates) > 1:
            try:
                reconciliation = await _request_reconciliation(settings, candidates)
            except Exception as exc:
                logger.warning("PDF import metadata reconciliation failed; using deterministic merge: %s", _import_error_detail(exc))
                warnings.append("题目元数据自动校对失败，已使用本地规则合并，请重点检查跨页题")
        merged, merge_warnings, merged_count = _merge_candidates(candidates, reconciliation)
        warnings.extend(merge_warnings)
        await _emit_progress(
            progress_callback,
            "merging",
            "题目合并完成",
            65,
            current=len(merged),
            total=len(merged),
            unit="question",
            detail=f"得到 {len(merged)} 道题目候选",
        )
        focused_count = 0
        for index, raw in enumerate(list(merged)):
            raw.setdefault("_recognition_warnings", [])
            if not _needs_focused_review(raw):
                raw["_validation_errors"] = []
                raw["_repair_attempted"] = False
                await _emit_progress(
                    progress_callback,
                    "focused_review",
                    "正在逐题校验",
                    65 + int(20 * (index + 1) / max(1, len(merged))),
                    current=index + 1,
                    total=len(merged),
                    unit="question",
                    detail=f"第 {index + 1}/{len(merged)} 道题校验完成",
                )
                continue
            raw["_repair_attempted"] = True
            await _emit_progress(
                progress_callback,
                "focused_review",
                "正在高清修复",
                65 + int(20 * index / max(1, len(merged))),
                current=index + 1,
                total=len(merged),
                unit="question",
                detail=f"正在等待模型复核第 {index + 1}/{len(merged)} 道题",
            )
            try:
                reviewed = await _request_focused_review(settings, document, raw, allow_type_change=True)
                reviewed.setdefault("source_page", raw.get("source_page"))
                reviewed.setdefault("source_end_page", raw.get("source_end_page"))
                reviewed["_recognition_warnings"] = list(raw.get("_recognition_warnings") or [])
                reviewed["_repair_attempted"] = True
                merged[index] = reviewed
                focused_count += 1
            except Exception as exc:
                detail = f"第 {raw.get('source_page')} 页题目 {raw.get('number') or index + 1} 高清复核失败，请人工核对"
                raw["_recognition_warnings"].append(detail)
                warnings.append(detail)
                logger.warning("Focused question review failed: %s", _import_error_detail(exc))
            await _emit_progress(
                progress_callback,
                "focused_review",
                "正在逐题校验",
                65 + int(20 * (index + 1) / max(1, len(merged))),
                current=index + 1,
                total=len(merged),
                unit="question",
                detail=f"第 {index + 1}/{len(merged)} 道题校验完成",
            )
        await _emit_progress(progress_callback, "crop_processing", "正在校正题目截图", 87, detail="正在计算并校验逐题裁剪区域")
        repair_crop_regions(document, merged)
        invalid_questions: list[dict[str, Any]] = []
        for index, raw in enumerate(merged, start=1):
            validation_errors = candidate_validation_errors(raw)
            raw["_validation_errors"] = validation_errors
            if validation_errors:
                label = raw.get("number") or index
                detail = f"第 {raw.get('source_page')} 页题目 {label} 识别结果不完整：{'；'.join(validation_errors)}"
                raw.setdefault("_recognition_warnings", []).append(detail)
                warnings.append(detail)
                invalid_questions.append({
                    "index": index,
                    "source_page": _positive_int(raw.get("source_page"), 1),
                    "number": str(raw.get("number") or ""),
                    "errors": validation_errors,
                    "repair_attempted": bool(raw.get("_repair_attempted")),
                })
            if _crop_is_suspicious(raw):
                detail = f"第 {raw.get('source_page')} 页题目 {raw.get('number') or ''} 的裁剪区域仍异常，请人工替换图片"
                raw.setdefault("_recognition_warnings", []).append(detail)
                warnings.append(detail)
        for page_number, expected in expected_by_page.items():
            actual = sum(int(item.get("source_page") or 0) == page_number for item in merged)
            if actual != expected:
                warnings.append(f"第 {page_number} 页题目清单为 {expected} 题，合并后为 {actual} 题，请人工核对")
        for item in merged:
            if not item.get("complete", True):
                warnings.append(f"第 {item.get('source_page')} 页的题目 {item.get('number') or ''} 可能不完整")
        # Preserve order while removing repeated diagnostics.
        warnings = list(dict.fromkeys(item for item in warnings if item.strip()))[:100]
        counts = {kind: 0 for kind in ("single_choice", "multiple_choice", "true_false", "fill_blank", "programming")}
        for raw in merged:
            kind = _question_type(raw.get("type"))
            counts[kind] = counts.get(kind, 0) + 1
        combined["questions"] = merged
        combined["diagnostics"] = {
            "warnings": warnings,
            "counts": counts,
            "retried_pages": sorted(retried_pages),
            "inventory_count": sum(expected_by_page.values()),
            "candidate_count": len(candidates),
            "merged_count": merged_count,
            "focused_review_count": focused_count,
            "invalid_count": len(invalid_questions),
            "invalid_questions": invalid_questions,
        }
        if not combined["questions"]:
            raise ValueError("没有识别到题目")
        await _emit_progress(
            progress_callback,
            "crop_processing",
            "识别结果已生成",
            90,
            current=len(merged),
            total=len(merged),
            unit="question",
            detail=f"已生成 {len(merged)} 道题目的结构化候选",
        )
        return document, pages, combined
    except BaseException:
        document.close()
        raise


def _save_crop(
    db: Session,
    settings: Settings,
    question_set_id: int,
    document: Any,
    raw: dict[str, Any],
    index: int,
    kind: str = "question",
    allow_page_fallback: bool = False,
) -> int | None:
    suspicious = _crop_is_suspicious(raw)
    if suspicious and not allow_page_fallback:
        return None
    try:
        import pymupdf as fitz
        if suspicious:
            start = _positive_int(raw.get("source_page"), 1)
            end = max(start, _positive_int(raw.get("source_end_page"), start))
            regions = [{"source_page": page_number, "bbox": [0, 0, 1, 1]} for page_number in range(start, end + 1)]
        else:
            regions = raw.get("crop_regions") or [{"source_page": raw.get("source_page"), "bbox": raw.get("bbox") or [0, 0, 1, 1]}]
        crops: list[bytes] = []
        sizes: list[tuple[int, int]] = []
        for region in regions:
            page_number = max(1, int(region.get("source_page") or raw.get("source_page") or 1))
            page = document[page_number - 1]
            x0, y0, x1, y1 = [float(value) for value in (region.get("bbox") or [0, 0, 1, 1])]
            x0, y0 = max(0, x0 - .02), max(0, y0 - .02)
            x1, y1 = min(1, x1 + .02), min(1, y1 + .02)
            if x1 <= x0 or y1 <= y0:
                raise ValueError("无效裁剪区域")
            rect = fitz.Rect(x0 * page.rect.width, y0 * page.rect.height, x1 * page.rect.width, y1 * page.rect.height)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=rect, alpha=False)
            if pixmap.width < 24 or pixmap.height < 24 or pixmap.width * pixmap.height > 40_000_000:
                raise ValueError("裁剪图片尺寸异常")
            crops.append(pixmap.tobytes("png"))
            sizes.append((pixmap.width, pixmap.height))
        if len(crops) == 1:
            data = crops[0]
        else:
            canvas = fitz.open()
            target = canvas.new_page(width=max(width for width, _ in sizes), height=sum(height for _, height in sizes))
            top = 0
            for crop, (width, height) in zip(crops, sizes):
                target.insert_image(fitz.Rect(0, top, width, top + height), stream=crop)
                top += height
            data = target.get_pixmap(matrix=fitz.Matrix(1, 1), alpha=False).tobytes("png")
            canvas.close()
        key = f"question-{question_set_id}-{index}-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}.png"
        root = Path(settings.question_asset_dir)
        root.mkdir(parents=True, exist_ok=True)
        (root / key).write_bytes(data)
        asset = QuestionAsset(question_set_id=question_set_id, storage_key=key, original_name=key, mime_type="image/png", kind=kind, size_bytes=len(data))
        db.add(asset)
        db.flush()
        return asset.id
    except (ValueError, TypeError, IndexError):
        return None


def materialize_draft(db: Session, settings: Settings, source_asset: QuestionAsset, document: Any, payload: dict[str, Any]) -> QuestionSet:
    max_sort_order = db.scalar(select(func.max(QuestionSet.sort_order)))
    next_sort_order = 0 if max_sort_order is None else max_sort_order + 1
    question_set = QuestionSet(
        title=str(payload.get("title") or source_asset.original_name)[:180],
        description=_safe_markdown(payload.get("description"), 5000),
        status="draft",
        sort_order=next_sort_order,
        source_pdf_asset_id=source_asset.id,
    )
    db.add(question_set)
    db.flush()
    source_asset.question_set_id = question_set.id
    for index, raw in enumerate(payload.get("questions", []), start=1):
        if not isinstance(raw, dict):
            continue
        kind = _question_type(raw.get("type"))
        points = _bounded_int(raw.get("points"), 25 if kind == "programming" else 2, 1, 10000)
        source_page = _positive_int(raw.get("source_page"), 1)
        validation_errors = list(raw.get("_validation_errors") or candidate_validation_errors(raw))
        recognition_warnings = [str(item) for item in raw.get("_recognition_warnings") or [] if str(item).strip()]
        if validation_errors:
            recognition_warnings.append("识别结果不完整，请人工补全：" + "；".join(validation_errors))
        question = Question(
            question_set_id=question_set.id,
            type=kind,
            stem_markdown=_safe_markdown(raw.get("stem_markdown")) or f"第 {index} 题",
            explanation_markdown=_safe_markdown(raw.get("explanation_markdown")),
            points=points,
            sort_order=index - 1,
            reviewed=False,
            correct_bool=_boolean_value(raw.get("correct_bool")) if kind == "true_false" else None,
            source_page=source_page,
            source_end_page=max(source_page, _positive_int(raw.get("source_end_page"), source_page)),
            recognition_confidence=_confidence_value(raw),
            recognition_warnings_json=json.dumps(list(dict.fromkeys(recognition_warnings))[:100], ensure_ascii=False),
            show_source_crop=bool(raw.get("has_visual")),
            source_section=str(raw.get("section") or "")[:180],
            source_number=str(raw.get("number") or "")[:80],
        )
        db.add(question)
        db.flush()
        question.source_asset_id = _save_crop(db, settings, question_set.id, document, raw, index, allow_page_fallback=True)
        if kind in {"single_choice", "multiple_choice"}:
            for option_index, option in enumerate(_mapping_items(raw.get("options"))):
                question.options.append(QuestionOption(
                    label=str(option.get("label") or chr(65 + option_index))[:16],
                    content_markdown=_safe_markdown(option.get("content_markdown"), 10000) or "（待补充）",
                    correct=_boolean_value(option.get("correct")) is True,
                    sort_order=option_index,
                ))
        elif kind == "fill_blank":
            for blank_index, blank in enumerate(_mapping_items(raw.get("blanks")), start=1):
                accepted = blank.get("accepted_answers") if isinstance(blank.get("accepted_answers"), list) else []
                answers = [str(value).strip() for value in accepted if str(value).strip()]
                question.blanks.append(QuestionBlank(
                    position=_positive_int(blank.get("position"), blank_index),
                    accepted_answers_json=json.dumps(list(dict.fromkeys(answers)), ensure_ascii=False),
                ))
        elif kind == "programming":
            program = raw.get("programming") if isinstance(raw.get("programming"), dict) else {}
            spec = ProgrammingSpec(
                input_markdown=_safe_markdown(program.get("input_markdown"), 20000),
                output_markdown=_safe_markdown(program.get("output_markdown"), 20000),
                constraints_markdown=_safe_markdown(program.get("constraints_markdown"), 20000),
                starter_code=str(program.get("starter_code") or "")[:100000],
                reference_solution=str(program.get("reference_solution") or "")[:100000],
                time_limit_ms=_bounded_int(program.get("time_limit_ms"), settings.judge_default_time_ms, 100, settings.judge_max_time_ms),
                memory_limit_mb=_bounded_int(program.get("memory_limit_mb"), settings.judge_default_memory_mb, 32, settings.judge_max_memory_mb),
            )
            for case in _mapping_items(program.get("cases")):
                input_data = str(case.get("input_data") or "")[:100000]
                expected_output = str(case.get("expected_output") or "")[:100000]
                # The JSON schema contains an empty case to describe its shape.
                # Vision models occasionally copy that placeholder verbatim;
                # it is not a runnable sample and would make input() raise EOF.
                if not input_data.strip() and not expected_output.strip():
                    continue
                is_sample = bool(case.get("is_sample"))
                spec.cases.append(ProgrammingCase(
                    input_data=input_data,
                    expected_output=expected_output if is_sample else "",
                    is_sample=is_sample,
                    weight=0 if is_sample else _bounded_int(case.get("weight"), 0, 0, 10000),
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
        job.diagnostics_json = json.dumps({
            "progress": progress_payload("starting", "正在启动识别", 1, detail=f"第 {job.attempts} 次尝试"),
        }, ensure_ascii=False)
        db.commit()
        return job.id


def _progress_callback(session_factory: Callable[[], Session], job_id: int) -> ProgressCallback:
    async def report(progress: dict[str, Any]) -> None:
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            if not job or job.status == "cancelled":
                raise asyncio.CancelledError
            if job.status != "processing":
                return
            diagnostics = _json_mapping(job.diagnostics_json)
            previous = diagnostics.get("progress") if isinstance(diagnostics.get("progress"), dict) else {}
            progress["percent"] = max(int(previous.get("percent") or 0), int(progress.get("percent") or 0))
            diagnostics["progress"] = progress
            job.diagnostics_json = json.dumps(diagnostics, ensure_ascii=False)
            db.commit()

    return report


def _json_mapping(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, json.JSONDecodeError):
        parsed = {}
    return parsed if isinstance(parsed, dict) else {}


async def _process_job(session_factory: Callable[[], Session], settings: Settings, job_id: int) -> None:
    document = None
    progress = _progress_callback(session_factory, job_id)
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
        document, pages, payload = await parse_pdf(settings, path, progress)
        await _emit_progress(
            progress,
            "saving",
            "正在保存草稿题套",
            95,
            current=len(payload.get("questions") or []),
            total=len(payload.get("questions") or []),
            unit="question",
            detail="正在写入题目、答案与原题截图",
        )
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            asset = db.get(QuestionAsset, asset_id)
            if not job or not asset or job.status == "cancelled":
                return
            question_set = materialize_draft(db, settings, asset, document, payload)
            diagnostics = dict(payload.get("diagnostics") or {})
            diagnostics["progress"] = progress_payload(
                "completed",
                "识别完成",
                100,
                current=len(payload.get("questions") or []),
                total=len(payload.get("questions") or []),
                unit="question",
                detail=f"已生成 {len(payload.get('questions') or [])} 道草稿题目",
            )
            updated = db.execute(update(QuestionImportJob).where(
                QuestionImportJob.id == job_id,
                QuestionImportJob.status == "processing",
            ).values(
                question_set_id=question_set.id,
                page_count=len(pages),
                diagnostics_json=json.dumps(diagnostics, ensure_ascii=False),
                status="ready",
                processing_started_at=None,
            ))
            if updated.rowcount != 1:
                db.rollback()
                return
            db.commit()
            logger.info(
                "PDF import job %s completed: pages=%s questions=%s question_set_id=%s",
                job_id,
                len(pages),
                len(payload.get("questions", [])),
                question_set.id,
            )
    except asyncio.CancelledError:
        logger.info("PDF import job %s was cancelled or interrupted", job_id)
        raise
    except Exception as exc:
        error_detail = _import_error_detail(exc)
        final_status = "pending"
        with session_factory() as db:
            job = db.get(QuestionImportJob, job_id)
            if job and job.status != "cancelled":
                diagnostics = _json_mapping(job.diagnostics_json)
                previous = diagnostics.get("progress") if isinstance(diagnostics.get("progress"), dict) else {}
                terminal = job.attempts >= settings.import_llm_max_retries
                diagnostics["progress"] = progress_payload(
                    "failed" if terminal else "retry_wait",
                    "识别失败" if terminal else "等待自动重试",
                    int(previous.get("percent") or 0),
                    detail=error_detail[:500],
                )
                job.error = error_detail
                job.status = "failed" if terminal else "pending"
                job.processing_started_at = None if job.status == "failed" else datetime.utcnow() + timedelta(seconds=min(300, 2 ** job.attempts))
                job.diagnostics_json = json.dumps(diagnostics, ensure_ascii=False)
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
        task = asyncio.create_task(_process_job(session_factory, settings, job_id))
        register_active_job("import", job_id, task)
        try:
            await task
        except asyncio.CancelledError:
            current = asyncio.current_task()
            if current and current.cancelling():
                raise
        finally:
            unregister_active_job("import", job_id, task)
