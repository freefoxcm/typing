from pathlib import Path

import httpx
import pymupdf
import pytest

from app.config import Settings
from app.database import Base, create_db
from app.models import QuestionAsset
from app.question_imports import _extract_pages, _import_error_detail, _json_content, materialize_draft


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
