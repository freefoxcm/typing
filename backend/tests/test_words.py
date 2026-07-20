import json
from datetime import datetime
from pathlib import Path

from app.config import Settings
from app.database import create_db
from app.models import Base, Word, WordSet
from app.word_enrichment import _claim_word, _complete_word, _fail_word, llm_configured, mark_word_readiness, parse_llm_content
from app.word_imports import normalize_spelling, parse_word_import, validate_spelling
from fastapi.testclient import TestClient

from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'words.db'}",
        admin_username="root",
        admin_password="correct-horse",
        session_secret="test-secret-with-enough-entropy",
        frontend_dist=str(tmp_path / "dist"),
        seed_demo_data=False,
    )))


def login_admin(client: TestClient) -> None:
    assert client.post("/api/auth/admin/login", json={"username": "root", "password": "correct-horse"}).status_code == 200


def add_child_and_login(client: TestClient) -> None:
    assert client.post("/api/admin/children", json={"name": "小宇", "pin": "1234", "active": True}).status_code == 201
    client.post("/api/auth/logout")
    assert client.post("/api/auth/child/login", json={"name": "小宇", "pin": "1234"}).status_code == 200


def test_word_validation_and_import_merges_case_insensitive_duplicates():
    assert validate_spelling("C++") is None
    assert validate_spelling("machine learning") is None
    assert validate_spelling("中文") is not None
    assert normalize_spelling("  Node.js   API ") == "node.js api"
    parsed = parse_word_import("csv", "word,phonetic,meaning_zh\nApple,,苹果\n apple ,/ˈæpəl/,")
    assert not parsed.errors
    assert len(parsed.items) == 1
    assert parsed.items[0].spelling == "apple"
    assert parsed.items[0].phonetic == "/ˈæpəl/"
    assert parsed.items[0].meaning_zh == "苹果"
    json_result = parse_word_import("json", json.dumps({"words": [{"word": "cache", "meaning_zh": "缓存"}]}))
    assert json_result.items[0].meaning_zh == "缓存"


def test_word_api_visibility_attempts_and_report_modes(tmp_path):
    with make_client(tmp_path) as client:
        login_admin(client)
        created_set = client.post("/api/admin/word-sets", json={"title": "计算机英语", "description": "", "sort_order": 0, "active": True})
        assert created_set.status_code == 201
        set_id = created_set.json()["id"]
        ready = client.post("/api/admin/words", json={
            "word_set_id": set_id, "spelling": "Cache", "phonetic": "/kæʃ/", "meaning_zh": "缓存",
            "technical_meaning_zh": "临时保存的数据", "active": True,
        })
        pending = client.post("/api/admin/words", json={
            "word_set_id": set_id, "spelling": "thread", "phonetic": "", "meaning_zh": "",
            "technical_meaning_zh": "", "active": True,
        })
        assert ready.json()["enrichment_status"] == "ready"
        assert pending.json()["enrichment_status"] == "pending"
        add_child_and_login(client)
        summaries = client.get("/api/library/word-sets").json()
        assert summaries[0]["word_count"] == 1
        detail = client.get(f"/api/library/word-sets/{set_id}").json()
        assert [item["spelling"] for item in detail["words"]] == ["Cache"]
        saved = client.post("/api/practice/word-attempts", json={
            "word_id": ready.json()["id"], "duration_ms": 3000,
            "errors": [{"expected_char": "C", "actual_char": "c", "count": 1}],
        })
        assert saved.status_code == 200
        assert saved.json()["cpm"] == 100
        assert client.post("/api/practice/word-attempts", json={"word_id": pending.json()["id"], "duration_ms": 3000, "errors": []}).status_code == 404
        client.post("/api/auth/logout")
        login_admin(client)
        word_report = client.get("/api/admin/reports/summary?mode=word&days=30").json()
        course_report = client.get("/api/admin/reports/summary?mode=course&days=30").json()
        assert word_report["attempt_count"] == 1
        assert word_report["attempts"][0]["mode"] == "word"
        assert course_report["attempt_count"] == 0


def test_word_import_preview_and_nonempty_overwrite(tmp_path):
    with make_client(tmp_path) as client:
        login_admin(client)
        set_id = client.post("/api/admin/word-sets", json={"title": "基础", "description": "", "sort_order": 0, "active": True}).json()["id"]
        original = client.post("/api/admin/words", json={
            "word_set_id": set_id, "spelling": "Apple", "phonetic": "/old/", "meaning_zh": "苹果",
            "technical_meaning_zh": "", "active": True,
        }).json()
        payload = {"word_set_id": set_id, "format": "csv", "mode": "append", "content": "word,phonetic,meaning_zh\napple,/new/,"}
        preview = client.post("/api/admin/word-import/preview", json=payload).json()
        assert preview["updated_count"] == 1 and preview["created_count"] == 0 and preview["queued_count"] == 0
        assert client.post("/api/admin/word-import", json=payload).status_code == 200
        word = client.get("/api/admin/word-sets").json()[0]["words"][0]
        assert word["id"] == original["id"]
        assert word["spelling"] == "apple"
        assert word["phonetic"] == "/new/"
        assert word["meaning_zh"] == "苹果"


def test_llm_parsing_completion_failure_and_manual_readiness(tmp_path):
    values = parse_llm_content('```json\n{"phonetic":"/kæʃ/","meaning_zh":"缓存","technical_meaning_zh":"高速临时存储"}\n```')
    assert values["meaning_zh"] == "缓存"
    engine, factory = create_db(f"sqlite:///{tmp_path / 'queue.db'}")
    Base.metadata.create_all(engine)
    with factory() as db:
        word_set = WordSet(title="技术词", description="", sort_order=0, active=True)
        db.add(word_set); db.flush()
        word = Word(word_set_id=word_set.id, spelling="cache", normalized_spelling="cache", enrichment_status="processing", processing_started_at=datetime.utcnow())
        db.add(word); db.commit(); word_id = word.id
    _complete_word(factory, word_id, values)
    with factory() as db:
        completed = db.get(Word, word_id)
        assert completed.enrichment_status == "ready"
        completed.phonetic = ""; completed.enrichment_status = "processing"; db.commit()
    settings = Settings(llm_max_retries=1, seed_demo_data=False)
    assert llm_configured(settings) is False
    _fail_word(factory, word_id, settings, ValueError("bad json"))
    with factory() as db:
        failed = db.get(Word, word_id)
        assert failed.enrichment_status == "failed"
        failed.phonetic = "/kæʃ/"; mark_word_readiness(failed); db.commit()
        assert failed.enrichment_status == "ready"
    engine.dispose()


def test_queue_reclaims_stale_work_and_does_not_overwrite_manual_completion(tmp_path):
    engine, factory = create_db(f"sqlite:///{tmp_path / 'reclaim.db'}")
    Base.metadata.create_all(engine)
    with factory() as db:
        word_set = WordSet(title="重试词", description="", sort_order=0, active=True)
        db.add(word_set); db.flush()
        word = Word(
            word_set_id=word_set.id, spelling="thread", normalized_spelling="thread",
            enrichment_status="processing", processing_started_at=datetime(2020, 1, 1),
        )
        db.add(word); db.commit(); word_id = word.id
    assert _claim_word(factory) == (word_id, "thread")
    with factory() as db:
        word = db.get(Word, word_id)
        word.phonetic = "/θred/"; word.meaning_zh = "线程"; mark_word_readiness(word); db.commit()
    _complete_word(factory, word_id, {"phonetic": "/wrong/", "meaning_zh": "错误", "technical_meaning_zh": "不应写入"})
    with factory() as db:
        word = db.get(Word, word_id)
        assert (word.phonetic, word.meaning_zh, word.technical_meaning_zh) == ("/θred/", "线程", "")
    engine.dispose()
