import asyncio
import base64
import html
import json
import logging
import re
from copy import deepcopy
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Callable

import httpx
from sqlalchemy import func, or_, select, update
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
        '"type":"single_choice|multiple_choice|true_false|programming",'
        '"stem_markdown":"题面","explanation_markdown":"解析","points":2,"correct_bool":null,'
        '"source_page":1,"source_end_page":1,"complete":true,"has_visual":false,"bbox":[0,0,1,1],'
        '"options":[{"label":"A","content_markdown":"选项","correct":true}],'
        '"programming":{"input_markdown":"","output_markdown":"","constraints_markdown":"",'
        '"starter_code":"","reference_solution":"","time_limit_ms":1000,"memory_limit_mb":128,'
        '"cases":[{"input_data":"","expected_output":"","is_sample":true,"weight":0,"note":""}]}}]}。'
        f"本次仅输出起始页为 {primary_pages} 的题目；其他页只是上下文，不得单独输出其上开始的题。"
        "page_inventory 必须逐个列出主页面上开始的题目，并与 questions 使用相同 candidate_id。"
        "一道编程题的题面、小问、代码、样例和续页必须合并为同一题，除非试卷明确印有新题号和独立分值。"
        "题目被截断或续页不足时 complete=false，source_end_page 是实际覆盖的最后页。"
        "bbox 使用起始页的相对坐标 0 到 1。识别答案表但不要把答案表写入题面；保留代码块和原始缩进。"
        "编程题隐藏用例只能作为未确认候选，is_sample=false，weight 可建议但不能标记确认。"
        "必须使用标准 JSON：所有属性名和字符串使用英文双引号，字符串内换行和反斜杠必须转义，禁止尾逗号、注释和省略号。"
    )
    content: list[dict[str, Any]] = [{"type": "text", "text": "请把这些连续试卷页面解析为结构化题库。" + schema}]
    for page in pages:
        content.append({"type": "text", "text": f"第 {page['number']} 页提取文本：\n{page['text']}"})
        content.append({"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(page["png"]).decode("ascii")}})
    endpoint = f"{settings.import_llm_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.import_llm_api_key}", "Content-Type": "application/json"}
    request_body: dict[str, Any] = {
        "model": settings.import_llm_model,
        "temperature": 0,
        "messages": [
            {"role": "system", "content": "你是严谨的中文试卷数字化编辑。只能输出一个语法严格合法的 JSON 对象，不要解释，不要使用 Markdown 代码围栏。"},
            {"role": "user", "content": content},
        ],
    }
    if settings.import_llm_model.strip().lower() == "minimax-m3":
        request_body["thinking"] = {"type": "disabled"}
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
            repair_body: dict[str, Any] = {
                "model": settings.import_llm_model,
                "temperature": 0,
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "你是 JSON 语法修复器。修复用户提供的 JSON，使其能被标准 JSON 解析器读取。"
                            "不得增删题目或改变字段值；所有属性名和字符串使用英文双引号；正确转义换行和反斜杠；"
                            "删除尾逗号。只输出修复后的 JSON 对象，不要解释或使用 Markdown。"
                        ),
                    },
                    {"role": "user", "content": raw_content},
                ],
            }
            if settings.import_llm_model.strip().lower() == "minimax-m3":
                repair_body["thinking"] = {"type": "disabled"}
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
    if settings.import_llm_model.strip().lower() == "minimax-m3":
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
    return (
        (100000 if raw.get("complete", True) else 0)
        + len(str(raw.get("stem_markdown") or ""))
        + len(str(raw.get("explanation_markdown") or ""))
        + len(json.dumps(program, ensure_ascii=False))
        + len(options) * 100
    )


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


async def parse_pdf(settings: Settings, path: Path) -> tuple[Any, list[dict[str, Any]], dict[str, Any]]:
    document, pages = _extract_pages(path, settings)
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

        numbering_pages, numbering_warnings = _numbering_anomalies(candidates)
        retried_pages.update(numbering_pages)
        warnings.extend(numbering_warnings)

        # Retry only pages whose inventory count disagrees or whose question was
        # marked incomplete. Include one previous and two following pages so a
        # long programming statement can be reconstructed without a huge request.
        for retry_index, page_number in enumerate(sorted(retried_pages), start=1):
            focus = [page for page in pages if page_number - 1 <= int(page["number"]) <= page_number + 2]
            logger.info("PDF import focused retry %s: file=%s primary=%s context=%s", retry_index, path.name, page_number, [page["number"] for page in focus])
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

        reconciliation: dict[str, Any] | None = None
        if len(candidates) > 1:
            try:
                reconciliation = await _request_reconciliation(settings, candidates)
            except Exception as exc:
                logger.warning("PDF import metadata reconciliation failed; using deterministic merge: %s", _import_error_detail(exc))
                warnings.append("题目元数据自动校对失败，已使用本地规则合并，请重点检查跨页题")
        merged, merge_warnings, merged_count = _merge_candidates(candidates, reconciliation)
        warnings.extend(merge_warnings)
        for page_number, expected in expected_by_page.items():
            actual = sum(int(item.get("source_page") or 0) == page_number for item in merged)
            if actual != expected:
                warnings.append(f"第 {page_number} 页题目清单为 {expected} 题，合并后为 {actual} 题，请人工核对")
        for item in merged:
            if not item.get("complete", True):
                warnings.append(f"第 {item.get('source_page')} 页的题目 {item.get('number') or ''} 可能不完整")
        # Preserve order while removing repeated diagnostics.
        warnings = list(dict.fromkeys(item for item in warnings if item.strip()))[:100]
        counts = {kind: 0 for kind in ("single_choice", "multiple_choice", "true_false", "programming")}
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
        }
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
            source_page=_positive_int(raw.get("source_page"), 1),
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
            job.diagnostics_json = json.dumps(payload.get("diagnostics") or {}, ensure_ascii=False)
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
