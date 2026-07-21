import asyncio
from pathlib import Path

import httpx
import pymupdf
import pytest

from app.config import Settings
from app.database import Base, create_db
from app.models import QuestionAsset
import app.question_imports as question_imports
from app.exercise_library import question_dict
from app.models import Question
from app.question_imports import _extract_pages, _import_error_detail, _json_content, _merge_candidates, _page_batches, _safe_markdown, materialize_draft, parse_pdf


def make_pdf(path: Path, pages: int = 1) -> None:
    document = pymupdf.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 100), f"Question page {index + 1}")
    document.save(path)
    document.close()


def test_pdf_extraction_renders_pages_and_enforces_limit(tmp_path):
    path = tmp_path / "paper.pdf"
    make_pdf(path, 2)
    document, pages = _extract_pages(path, Settings(import_max_pages=2))
    assert len(pages) == 2
    assert "Question page 1" in pages[0]["text"]
    assert pages[0]["png"].startswith(b"\x89PNG")
    document.close()
    with pytest.raises(ValueError, match="超过 1 页"):
        _extract_pages(path, Settings(import_max_pages=1))


def test_page_batches_limit_request_size_and_overlap_boundaries():
    pages = [{"number": number} for number in range(1, 11)]

    batches = list(_page_batches(pages, 3))

    assert [[page["number"] for page in batch] for batch in batches] == [
        [1, 2, 3],
        [3, 4, 5],
        [5, 6, 7],
        [7, 8, 9],
        [9, 10],
    ]
    assert list(_page_batches(pages[:2], 1)) == [[pages[0]], [pages[1]]]


def test_llm_json_and_draft_materialization_keep_visuals_unreviewed(tmp_path):
    path = tmp_path / "paper.pdf"
    make_pdf(path)
    document, _ = _extract_pages(path, Settings(import_max_pages=2))
    engine, session_factory = create_db(f"sqlite:///{tmp_path / 'db.sqlite'}")
    Base.metadata.create_all(engine)
    settings = Settings(question_asset_dir=str(tmp_path / "assets"))
    payload = _json_content('```json\n{"title":"样卷","questions":[{"number":"1","type":"single_choice","stem_markdown":"1+1=?","points":2,"source_page":1,"has_visual":true,"bbox":[0,0,1,0.3],"options":[{"label":"A","content_markdown":"1","correct":false},{"label":"B","content_markdown":"2","correct":true}]}]}\n```')
    with session_factory() as db:
        source = QuestionAsset(storage_key="source.pdf", original_name="paper.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
        db.add(source); db.flush()
        question_set = materialize_draft(db, settings, source, document, payload)
        db.commit()
        assert question_set.title == "样卷"
        assert question_set.status == "draft"
        assert question_set.questions[0].reviewed is False
        assert question_set.questions[0].source_asset_id is not None
        assert list((tmp_path / "assets").glob("question-*.png"))
    document.close()
    engine.dispose()


def test_llm_json_parser_ignores_thinking_and_repairs_trailing_commas():
    payload = _json_content(
        '<think>先构造一个 {草稿}。</think>\n```json\n'
        '{"title":"样卷","questions":[{"number":"1","type":"true_false",}],}\n```'
    )

    assert payload["title"] == "样卷"
    assert payload["questions"][0]["type"] == "true_false"


def test_llm_json_parser_reports_location_and_response_context():
    with pytest.raises(ValueError, match="第 1 行第") as caught:
        _json_content('{"title":"样卷","questions":[{bad:value}]}')

    assert "响应片段" in str(caught.value)
    assert "bad:value" in str(caught.value)


def test_import_error_detail_includes_upstream_body_and_redacts_secrets():
    request = httpx.Request(
        "POST",
        "https://example.test/v1/chat/completions?api_key=visible-secret",
        headers={"Authorization": "Bearer sk-do-not-log-this-secret"},
    )
    response = httpx.Response(
        400,
        request=request,
        headers={"x-request-id": "request-123"},
        json={"error": {"message": "unknown model", "debug_key": "sk-another-secret-value"}},
    )
    error = httpx.HTTPStatusError("bad response", request=request, response=response)

    detail = _import_error_detail(error)

    assert "HTTP 400" in detail
    assert "unknown model" in detail
    assert "request_id=request-123" in detail
    assert "visible-secret" not in detail
    assert "do-not-log" not in detail
    assert "another-secret" not in detail


def test_markdown_comparison_operators_are_not_double_escaped():
    assert _safe_markdown("0 &lt; x < 10 &gt; 2") == "0 < x < 10 > 2"
    question = Question(
        id=1,
        question_set_id=1,
        type="true_false",
        stem_markdown="x &lt; 10 and y &gt; 0",
        explanation_markdown="<script>alert(1)</script>",
        points=2,
        sort_order=0,
        reviewed=True,
        correct_bool=True,
        show_source_crop=False,
    )
    result = question_dict(question)
    assert result["stem_markdown"] == "x < 10 and y > 0"
    assert result["explanation_markdown"] == "<script>alert(1)</script>"


def test_candidate_merge_joins_cross_page_programming_fragments_but_keeps_sections_separate():
    base_program = {"input_markdown": "N", "output_markdown": "", "constraints_markdown": "", "starter_code": "", "reference_solution": "", "cases": []}
    candidates = [
        {"_candidate_id": "c1", "number": "1", "section": "三、编程题", "type": "programming", "source_page": 4, "source_end_page": 4, "complete": False, "stem_markdown": "计算阶乘", "programming": base_program},
        {"_candidate_id": "c2", "number": "1", "section": "三、编程题", "type": "programming", "source_page": 5, "source_end_page": 5, "complete": True, "stem_markdown": "计算阶乘并输出结果", "programming": {**base_program, "output_markdown": "N!", "cases": [{"input_data": "3\n", "expected_output": "6\n", "is_sample": True}]}},
        {"_candidate_id": "c3", "number": "1", "section": "四、附加题", "type": "programming", "source_page": 5, "source_end_page": 5, "complete": True, "stem_markdown": "输出图形", "programming": base_program},
    ]
    merged, warnings, merged_count = _merge_candidates(candidates, {"groups": [{"candidate_ids": ["c1", "c2"]}], "warnings": []})
    assert len(merged) == 2
    assert merged_count == 1
    assert any("已合并 1" in warning for warning in warnings)
    factorial = next(item for item in merged if item["section"] == "三、编程题")
    assert factorial["source_page"] == 4
    assert factorial["source_end_page"] == 5
    assert factorial["programming"]["output_markdown"] == "N!"


def test_parse_pdf_retries_incomplete_primary_page_and_reconciles(monkeypatch, tmp_path):
    path = tmp_path / "paper.pdf"
    make_pdf(path, 4)
    calls: list[list[int]] = []

    async def fake_batch(_settings, _pages, primary_pages=None):
        primary = list(primary_pages or [])
        calls.append(primary)
        if primary == [1, 2]:
            return {
                "title": "跨页样卷",
                "page_inventory": [
                    {"source_page": 1, "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "编程题", "type": "programming"}]},
                    {"source_page": 2, "questions": []},
                ],
                "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "编程题", "type": "programming", "source_page": 1, "source_end_page": 2, "complete": False, "stem_markdown": "跨页题前半", "programming": {"cases": []}}],
            }
        if primary == [3, 4]:
            return {"page_inventory": [{"source_page": 3, "questions": []}, {"source_page": 4, "questions": []}], "questions": []}
        assert primary == [1]
        return {
            "page_inventory": [{"source_page": 1, "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "编程题", "type": "programming"}]}],
            "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "编程题", "type": "programming", "source_page": 1, "source_end_page": 3, "complete": True, "stem_markdown": "完整跨页编程题", "programming": {"input_markdown": "N", "cases": []}}],
        }

    async def fake_reconciliation(_settings, candidates):
        assert len(candidates) == 2
        return {"groups": [{"candidate_ids": ["b1-q1", "r1-q1"]}], "warnings": [], "questions": []}

    monkeypatch.setattr(question_imports, "_request_batch", fake_batch)
    monkeypatch.setattr(question_imports, "_request_reconciliation", fake_reconciliation)
    document, _, payload = asyncio.run(parse_pdf(Settings(import_llm_batch_pages=3), path))
    try:
        assert calls == [[1, 2], [3, 4], [1]]
        assert len(payload["questions"]) == 1
        assert payload["questions"][0]["stem_markdown"] == "完整跨页编程题"
        assert payload["diagnostics"]["retried_pages"] == [1]
        assert payload["diagnostics"]["counts"]["programming"] == 1
    finally:
        document.close()
