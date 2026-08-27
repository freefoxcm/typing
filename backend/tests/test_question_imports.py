import asyncio
import json
from pathlib import Path

import httpx
import pymupdf
import pytest

from app.config import Settings
from app.database import Base, create_db
from app.models import QuestionAsset
import app.question_imports as question_imports
from app.exercise_library import question_dict, question_errors
from app.models import Question
from app.question_imports import _crop_is_suspicious, _extract_pages, _import_error_detail, _json_content, _merge_candidates, _model_request_body, _needs_focused_review, _page_batches, _safe_markdown, candidate_validation_errors, materialize_draft, parse_pdf, repair_crop_regions


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


def test_focused_review_targets_complex_low_confidence_and_bad_crops():
    ordinary = {"type": "single_choice", "source_page": 1, "source_end_page": 1, "complete": True, "stem_markdown": "1+1", "options": [{"label": "A", "content_markdown": "1", "correct": False}, {"label": "B", "content_markdown": "2", "correct": True}], "confidence": {"stem": .98, "answer": .97, "crop": .96}, "crop_regions": [{"source_page": 1, "bbox": [.1, .1, .9, .4]}]}
    assert _needs_focused_review(ordinary) is False
    assert _needs_focused_review({**ordinary, "confidence": {"stem": .7}}) is True
    assert _needs_focused_review({**ordinary, "type": "programming"}) is True
    assert _crop_is_suspicious({**ordinary, "crop_regions": [{"source_page": 1, "bbox": [-.1, .1, .9, .4]}]}) is True
    assert _crop_is_suspicious({**ordinary, "crop_regions": [{"source_page": 1, "bbox": [0, 0, 1, 1]}]}) is True
    assert _crop_is_suspicious({**ordinary, "crop_regions": [{"source_page": 1, "bbox": [0, .2, 1, .201]}]}) is True


def test_candidate_validation_reports_semantic_and_nested_shape_errors():
    judgment = {"type": "true_false", "stem_markdown": "Python 区分大小写", "source_page": 1, "correct_bool": None}
    assert candidate_validation_errors(judgment) == ["判断题缺少明确的正确答案"]
    choice = {"type": "single_choice", "stem_markdown": "选择", "source_page": 1, "points": "两分", "options": ["A", {"label": "B", "correct": False}]}
    errors = candidate_validation_errors(choice)
    assert "分值不是有效整数" in errors
    assert "选项结构无效" in errors
    assert "单选题必须且只能有一个正确选项" in errors
    programming = {"type": "programming", "stem_markdown": "编程", "source_page": 1, "programming": "not-an-object"}
    assert "编程题缺少有效的编程规格" in candidate_validation_errors(programming)


def test_reasoning_effort_is_optional_and_overrides_minimax_thinking():
    messages = [{"role": "user", "content": "test"}]
    default = _model_request_body(Settings(import_llm_model="vision"), messages)
    assert "reasoning_effort" not in default and "thinking" not in default
    minimax = _model_request_body(Settings(import_llm_model="minimax-m3"), messages)
    assert minimax["thinking"] == {"type": "disabled"}
    configured = _model_request_body(Settings(import_llm_model="minimax-m3", import_llm_reasoning_effort=" high "), messages)
    assert configured["reasoning_effort"] == "high" and "thinking" not in configured


def test_suspicious_full_page_crop_uses_pdf_text_boundaries():
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text((72, 100), "1 First question alpha")
    page.insert_text((72, 300), "2 Second question beta")
    questions = [
        {"number": "1", "stem_markdown": "First question alpha", "source_page": 1, "crop_regions": [{"source_page": 1, "bbox": [0, 0, 1, 1]}]},
        {"number": "2", "stem_markdown": "Second question beta", "source_page": 1, "crop_regions": [{"source_page": 1, "bbox": [.1, .35, .8, .5]}]},
    ]
    repair_crop_regions(document, questions)
    bbox = questions[0]["crop_regions"][0]["bbox"]
    assert bbox[1] > 0 and bbox[3] < .5
    assert not _crop_is_suspicious(questions[0])
    assert "PDF 文本层" in questions[0]["_recognition_warnings"][0]
    document.close()


def test_llm_json_and_draft_materialization_keep_visuals_unreviewed(tmp_path):
    path = tmp_path / "paper.pdf"
    make_pdf(path)
    document, _ = _extract_pages(path, Settings(import_max_pages=2))
    engine, session_factory = create_db(f"sqlite:///{tmp_path / 'db.sqlite'}")
    Base.metadata.create_all(engine)
    settings = Settings(question_asset_dir=str(tmp_path / "assets"))
    payload = _json_content('```json\n{"title":"样卷","questions":[{"number":"1","type":"single_choice","stem_markdown":"1+1=?","points":2,"source_page":1,"has_visual":true,"bbox":[0,0,1,1],"options":[{"label":"A","content_markdown":"1","correct":false},{"label":"B","content_markdown":"2","correct":true}]}]}\n```')
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


def test_materialize_draft_keeps_invalid_candidates_for_manual_completion(tmp_path):
    path = tmp_path / "invalid.pdf"
    make_pdf(path)
    document, _ = _extract_pages(path, Settings(import_max_pages=2))
    engine, session_factory = create_db(f"sqlite:///{tmp_path / 'invalid.db'}")
    Base.metadata.create_all(engine)
    payload = {"title": "待补试卷", "questions": [
        {"type": "true_false", "stem_markdown": "Python 区分大小写", "points": "两分", "source_page": 1, "correct_bool": None},
        {"type": "single_choice", "stem_markdown": "选择正确项", "source_page": 1, "options": ["坏选项", {"label": "B", "content_markdown": "候选", "correct": False}]},
        {"type": "programming", "stem_markdown": "输出答案", "source_page": 1, "programming": "invalid"},
    ]}
    with session_factory() as db:
        source = QuestionAsset(storage_key="invalid.pdf", original_name="invalid.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
        db.add(source); db.flush()
        question_set = materialize_draft(db, Settings(question_asset_dir=str(tmp_path / "assets")), source, document, payload)
        db.commit()
        assert len(question_set.questions) == 3
        assert question_set.questions[0].correct_bool is None
        assert "判断题缺少明确的正确答案" in question_set.questions[0].recognition_warnings_json
        assert len(question_set.questions[1].options) == 1
        assert "选项结构无效" in question_set.questions[1].recognition_warnings_json
        assert question_set.questions[2].programming is not None
        assert "编程题缺少有效的编程规格" in question_set.questions[2].recognition_warnings_json
        assert all(not item.reviewed for item in question_set.questions)
        assert "题目缺少判断答案" in question_errors(question_set.questions[0])
        assert "题目至少需要两个选项" in question_errors(question_set.questions[1])
    document.close()
    engine.dispose()


def test_cross_page_crop_is_stitched_and_fill_blank_is_materialized(tmp_path):
    path = tmp_path / "cross-page.pdf"
    make_pdf(path, 2)
    document, _ = _extract_pages(path, Settings(import_max_pages=2))
    engine, session_factory = create_db(f"sqlite:///{tmp_path / 'cross.db'}")
    Base.metadata.create_all(engine)
    settings = Settings(question_asset_dir=str(tmp_path / "assets"))
    payload = {"title": "跨页题", "questions": [{
        "number": "1", "type": "fill_blank", "stem_markdown": "{{1}}", "points": 2,
        "source_page": 1, "source_end_page": 2, "has_visual": True,
        "crop_regions": [{"source_page": 1, "bbox": [0, 0, 1, .3]}, {"source_page": 2, "bbox": [0, 0, 1, .3]}],
        "blanks": [{"position": 1, "accepted_answers": ["答案"]}],
    }]}
    with session_factory() as db:
        source = QuestionAsset(storage_key="source.pdf", original_name="paper.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
        db.add(source); db.flush()
        question_set = materialize_draft(db, settings, source, document, payload)
        db.commit()
        question = question_set.questions[0]
        assert question.source_end_page == 2
        assert json.loads(question.blanks[0].accepted_answers_json) == ["答案"]
        asset = db.get(QuestionAsset, question.source_asset_id)
        pixmap = pymupdf.Pixmap((tmp_path / "assets" / asset.storage_key).read_bytes())
        assert pixmap.height > pixmap.width / 2
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


def test_parse_pdf_repairs_semantically_invalid_question_without_failing_set(monkeypatch, tmp_path):
    path = tmp_path / "judgment.pdf"
    make_pdf(path)
    focused_calls = 0

    async def fake_batch(_settings, _pages, primary_pages=None):
        return {
            "title": "判断卷",
            "page_inventory": [{"source_page": 1, "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "判断题", "type": "true_false"}]}],
            "questions": [{"candidate_id": "p1-q1", "number": "1", "section": "判断题", "type": "true_false", "source_page": 1, "source_end_page": 1, "complete": True, "stem_markdown": "Python 区分大小写", "correct_bool": None, "crop_regions": [{"source_page": 1, "bbox": [.1, .1, .9, .4]}]}],
        }

    async def fake_focused(_settings, _document, raw, allow_type_change=False):
        nonlocal focused_calls
        focused_calls += 1
        assert allow_type_change is True
        return {**raw, "correct_bool": True}

    monkeypatch.setattr(question_imports, "_request_batch", fake_batch)
    monkeypatch.setattr(question_imports, "_request_focused_review", fake_focused)
    document, _, payload = asyncio.run(parse_pdf(Settings(import_llm_batch_pages=3), path))
    try:
        assert focused_calls == 1
        assert payload["questions"][0]["correct_bool"] is True
        assert payload["questions"][0]["_repair_attempted"] is True
        assert payload["diagnostics"]["invalid_count"] == 0
    finally:
        document.close()


def test_imported_programming_question_drops_empty_schema_case(tmp_path):
    path = tmp_path / "program.pdf"
    make_pdf(path)
    document, _ = _extract_pages(path, Settings(import_max_pages=2))
    engine, session_factory = create_db(f"sqlite:///{tmp_path / 'program.db'}")
    Base.metadata.create_all(engine)
    payload = {
        "title": "编程样卷",
        "questions": [{
            "type": "programming", "stem_markdown": "输出 Hello", "points": 10, "source_page": 1,
            "programming": {"reference_solution": "print('Hello')", "cases": [{"input_data": "", "expected_output": "", "is_sample": True, "weight": 0}]},
        }],
    }
    with session_factory() as db:
        source = QuestionAsset(storage_key="program.pdf", original_name="program.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
        db.add(source); db.flush()
        question_set = materialize_draft(db, Settings(question_asset_dir=str(tmp_path / "assets")), source, document, payload)
        assert question_set.questions[0].programming.cases == []
    document.close()
    engine.dispose()
