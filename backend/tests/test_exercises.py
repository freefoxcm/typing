import asyncio
import json
import base64
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
import app.question_recognition as question_recognition
from app.job_control import cancel_active_job, register_active_job, unregister_active_job
from app.routers import admin_exercises as admin_exercises_router
from app.routers import exercises as exercises_router
from app.models import (
    AttemptError,
    ChildProfile,
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    PracticeAttempt,
    Question,
    QuestionAsset,
    QuestionImportJob,
    QuestionRecognitionJob,
    QuestionSet,
    Word,
    WordSet,
    WrongQuestion,
)
from app.question_recognition import question_fingerprint, set_fingerprint


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        admin_username="root",
        admin_password="correct-horse",
        session_secret="test-secret-with-enough-entropy",
        frontend_dist=str(tmp_path / "dist"),
        question_asset_dir=str(tmp_path / "assets"),
        judge_queue_dir=str(tmp_path / "judge"),
        seed_demo_data=False,
    )
    return TestClient(create_app(settings))


def admin_login(client: TestClient) -> None:
    assert client.post("/api/auth/admin/login", json={"username": "root", "password": "correct-horse"}).status_code == 200


def child_login(client: TestClient) -> None:
    client.post("/api/auth/logout")
    assert client.post("/api/auth/child/login", json={"name": "小宇", "pin": "1234"}).status_code == 200


def create_child(client: TestClient) -> int:
    response = client.post("/api/admin/children", json={"name": "小宇", "pin": "1234", "active": True})
    assert response.status_code == 201
    return response.json()["id"]


def create_objective_set(client: TestClient) -> tuple[int, int, int]:
    question_set = client.post("/api/admin/question-sets", json={"title": "Python 一级", "description": "练习"}).json()
    single = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
        "type": "single_choice", "stem_markdown": "Python 的输入函数是？", "explanation_markdown": "input 用于读取输入。",
        "points": 2, "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False,
        "options": [
            {"label": "A", "content_markdown": "print", "correct": False, "sort_order": 0},
            {"label": "B", "content_markdown": "input", "correct": True, "sort_order": 1},
        ], "programming": None,
    })
    assert single.status_code == 201
    judgment = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
        "type": "true_false", "stem_markdown": "Python 区分大小写。", "explanation_markdown": "变量名区分大小写。",
        "points": 2, "sort_order": 1, "reviewed": True, "correct_bool": True, "show_source_crop": False,
        "options": [], "programming": None,
    })
    assert judgment.status_code == 201
    published = client.post(f"/api/admin/question-sets/{question_set['id']}/publish")
    assert published.status_code == 200
    return question_set["id"], single.json()["id"], judgment.json()["id"]


def test_import_and_recognition_jobs_can_be_cancelled_idempotently_and_retried(monkeypatch, tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "取消任务", "description": ""}).json()
        with client.app.state.session_factory() as db:
            stored_set = db.get(QuestionSet, question_set["id"])
            asset = QuestionAsset(question_set_id=stored_set.id, storage_key="cancel.pdf", original_name="cancel.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
            db.add(asset); db.flush(); stored_set.source_pdf_asset_id = asset.id
            import_job = QuestionImportJob(
                source_asset_id=asset.id,
                status="processing",
                attempts=1,
                diagnostics_json=json.dumps({"progress": {"phase": "batch_recognition", "label": "正在批量识别", "percent": 42, "updated_at": "2026-08-27T00:00:00Z"}}),
            )
            recognition_job = QuestionRecognitionJob(
                scope="set", status="pending", target_set_id=stored_set.id, source_asset_id=asset.id,
                target_fingerprint=set_fingerprint(stored_set),
            )
            ready_job = QuestionRecognitionJob(
                scope="set", status="ready", target_set_id=stored_set.id, source_asset_id=asset.id,
                target_fingerprint=set_fingerprint(stored_set),
            )
            db.add_all([import_job, recognition_job, ready_job]); db.commit()
            import_id, recognition_id, ready_id = import_job.id, recognition_job.id, ready_job.id

        cancelled_import = client.post(f"/api/admin/question-imports/{import_id}/cancel")
        assert cancelled_import.status_code == 200
        assert cancelled_import.json()["status"] == "cancelled"
        assert cancelled_import.json()["progress"]["percent"] == 42
        assert client.post(f"/api/admin/question-imports/{import_id}/cancel").status_code == 200

        cancelled_recognition = client.post(f"/api/admin/question-recognition-jobs/{recognition_id}/cancel")
        assert cancelled_recognition.status_code == 200
        assert cancelled_recognition.json()["status"] == "cancelled"
        assert client.post(f"/api/admin/question-recognition-jobs/{recognition_id}/cancel").status_code == 200
        assert client.post(f"/api/admin/question-recognition-jobs/{ready_id}/cancel").status_code == 409

        monkeypatch.setattr(admin_exercises_router, "import_llm_configured", lambda _settings: True)
        retried_import = client.post(f"/api/admin/question-imports/{import_id}/retry")
        assert retried_import.status_code == 200 and retried_import.json()["status"] == "pending"
        retried_recognition = client.post(f"/api/admin/question-recognition-jobs/{recognition_id}/retry")
        assert retried_recognition.status_code == 200 and retried_recognition.json()["status"] == "pending"
        assert retried_recognition.json()["progress"]["percent"] == 0


def test_active_job_registry_cancels_only_the_target_task():
    async def scenario():
        blocker = asyncio.Event()
        task = asyncio.create_task(blocker.wait())
        register_active_job("recognition", 812, task)
        try:
            assert cancel_active_job("recognition", 812) is True
            try:
                await task
            except asyncio.CancelledError:
                pass
            else:
                raise AssertionError("active recognition task was not cancelled")
            assert cancel_active_job("recognition", 999) is False
        finally:
            unregister_active_job("recognition", 812, task)

    asyncio.run(scenario())


def test_recognition_worker_continues_after_one_job_is_cancelled(monkeypatch):
    async def scenario():
        started = asyncio.Event()
        reclaimed = asyncio.Event()
        calls = 0

        def fake_claim(_session_factory):
            nonlocal calls
            calls += 1
            if calls == 1:
                return 913
            reclaimed.set()
            return None

        async def fake_process(_session_factory, _settings, _job_id):
            started.set()
            await asyncio.Event().wait()

        monkeypatch.setattr(question_recognition, "_claim_job", fake_claim)
        monkeypatch.setattr(question_recognition, "_process_job", fake_process)
        worker = asyncio.create_task(question_recognition.question_recognition_worker(lambda: None, Settings()))
        try:
            await started.wait()
            assert cancel_active_job("recognition", 913) is True
            await asyncio.wait_for(reclaimed.wait(), timeout=1)
            assert worker.done() is False
        finally:
            worker.cancel()
            try:
                await worker
            except asyncio.CancelledError:
                pass

    asyncio.run(scenario())


def test_recognition_preview_apply_preserves_question_id_and_rejects_stale_result(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "重识别题套", "description": "旧说明"}).json()
        payload = {
            "type": "single_choice", "stem_markdown": "旧题面", "explanation_markdown": "旧解析", "points": 2,
            "sort_order": 0, "reviewed": False, "correct_bool": None, "show_source_crop": False,
            "source_page": 1, "source_end_page": 1, "source_section": "一", "source_number": "1",
            "options": [
                {"label": "A", "content_markdown": "错误", "correct": False, "sort_order": 0},
                {"label": "B", "content_markdown": "正确", "correct": True, "sort_order": 1},
            ], "blanks": [], "programming": None,
        }
        current = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json=payload).json()
        candidate = {key: value for key, value in current.items() if key not in {"id", "question_set_id"}}
        candidate.update({"stem_markdown": "重新识别后的题面", "reviewed": False, "source_asset_id": None})

        with client.app.state.session_factory() as db:
            stored_set = db.get(QuestionSet, question_set["id"])
            asset = QuestionAsset(question_set_id=stored_set.id, storage_key="source-test.pdf", original_name="source.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
            db.add(asset); db.flush()
            stored_set.source_pdf_asset_id = asset.id
            job = QuestionRecognitionJob(
                scope="set", status="ready", target_set_id=stored_set.id, source_asset_id=asset.id,
                target_fingerprint=set_fingerprint(stored_set), model="vision", base_url="https://example.test/v1",
                result_json=json.dumps({"title": stored_set.title, "description": stored_set.description, "changes": [{
                    "status": "matched", "question_id": current["id"], "current": current, "candidate": candidate, "changed_fields": ["stem_markdown"],
                }], "diagnostics": {}}, ensure_ascii=False),
            )
            db.add(job); db.commit(); job_id = job.id

        applied = client.post(f"/api/admin/question-recognition-jobs/{job_id}/apply")
        assert applied.status_code == 200, applied.text
        updated = applied.json()["question_set"]["questions"][0]
        assert updated["id"] == current["id"]
        assert updated["stem_markdown"] == "重新识别后的题面"
        assert updated["reviewed"] is False

        with client.app.state.session_factory() as db:
            stored_set = db.get(QuestionSet, question_set["id"])
            stale_job = QuestionRecognitionJob(
                scope="set", status="ready", target_set_id=stored_set.id, source_asset_id=stored_set.source_pdf_asset_id,
                target_fingerprint=set_fingerprint(stored_set), result_json=json.dumps({"changes": []}),
            )
            db.add(stale_job); db.commit(); stale_id = stale_job.id
        changed = client.put(f"/api/admin/questions/{current['id']}", json={**candidate, "stem_markdown": "人工又修改了"})
        assert changed.status_code == 200
        assert client.post(f"/api/admin/question-recognition-jobs/{stale_id}/apply").status_code == 409


def test_recognition_apply_keeps_invalid_match_in_order_and_skips_invalid_new_question(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "局部容错", "description": ""}).json()
        first_payload = {
            "type": "true_false", "stem_markdown": "原判断题", "explanation_markdown": "", "points": 2,
            "sort_order": 0, "reviewed": True, "correct_bool": True, "show_source_crop": False,
            "source_page": 1, "source_end_page": 1, "options": [], "blanks": [], "programming": None,
        }
        second_payload = {
            "type": "true_false", "stem_markdown": "原第二题", "explanation_markdown": "", "points": 2,
            "sort_order": 1, "reviewed": True, "correct_bool": False, "show_source_crop": False,
            "source_page": 1, "source_end_page": 1, "options": [], "blanks": [], "programming": None,
        }
        first = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json=first_payload).json()
        second = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json=second_payload).json()
        valid_candidate = {key: value for key, value in second.items() if key not in {"id", "question_set_id"}}
        valid_candidate.update({"stem_markdown": "更新后的第二题", "reviewed": False})
        invalid_candidate = {key: value for key, value in first.items() if key not in {"id", "question_set_id"}}
        invalid_candidate.update({"correct_bool": None, "reviewed": False})

        with client.app.state.session_factory() as db:
            stored_set = db.get(QuestionSet, question_set["id"])
            asset = QuestionAsset(question_set_id=stored_set.id, storage_key="tolerant.pdf", original_name="tolerant.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
            db.add(asset); db.flush(); stored_set.source_pdf_asset_id = asset.id
            job = QuestionRecognitionJob(
                scope="set", status="ready", target_set_id=stored_set.id, source_asset_id=asset.id,
                target_fingerprint=set_fingerprint(stored_set), result_json=json.dumps({"title": stored_set.title, "description": "", "changes": [
                    {"status": "invalid", "question_id": first["id"], "current": first, "candidate": invalid_candidate, "changed_fields": ["correct_bool"], "validation_errors": ["判断题缺少明确的正确答案"], "repair_attempted": True},
                    {"status": "matched", "question_id": second["id"], "current": second, "candidate": valid_candidate, "changed_fields": ["stem_markdown"]},
                    {"status": "invalid", "question_id": None, "current": None, "candidate": invalid_candidate, "changed_fields": ["新增题目"], "validation_errors": ["判断题缺少明确的正确答案"], "repair_attempted": True},
                ], "diagnostics": {"invalid_count": 2}}, ensure_ascii=False),
            )
            db.add(job); db.commit(); job_id = job.id

        applied = client.post(f"/api/admin/question-recognition-jobs/{job_id}/apply")
        assert applied.status_code == 200, applied.text
        questions = applied.json()["question_set"]["questions"]
        assert [item["id"] for item in questions] == [first["id"], second["id"]]
        assert questions[0]["stem_markdown"] == "原判断题" and questions[0]["reviewed"] is False
        assert "判断题缺少明确的正确答案" in " ".join(questions[0]["recognition_warnings"])
        assert questions[1]["stem_markdown"] == "更新后的第二题"

        with client.app.state.session_factory() as db:
            stored_first = db.get(Question, first["id"])
            single_job = QuestionRecognitionJob(
                scope="question", status="ready", target_set_id=question_set["id"], target_question_id=stored_first.id,
                source_asset_id=db.get(QuestionSet, question_set["id"]).source_pdf_asset_id,
                target_fingerprint=question_fingerprint(stored_first), result_json=json.dumps({"changes": [{
                    "status": "invalid", "question_id": stored_first.id, "current": first, "candidate": invalid_candidate,
                    "changed_fields": ["correct_bool"], "validation_errors": ["判断题缺少明确的正确答案"], "repair_attempted": True,
                }]}, ensure_ascii=False),
            )
            db.add(single_job); db.commit(); single_job_id = single_job.id
        rejected = client.post(f"/api/admin/question-recognition-jobs/{single_job_id}/apply")
        assert rejected.status_code == 422
        assert "单题重新识别结果无效" in rejected.json()["detail"]


def test_set_recognition_builds_partial_preview_when_one_candidate_is_invalid(monkeypatch, tmp_path):
    class FakeDocument:
        def close(self):
            pass

    async def fake_parse_pdf(_settings, _path):
        return FakeDocument(), [], {"title": "局部预览", "description": "", "questions": [
            {"type": "true_false", "stem_markdown": "旧判断题", "source_page": 1, "correct_bool": None, "_repair_attempted": True, "_validation_errors": ["判断题缺少明确的正确答案"]},
            {"type": "true_false", "stem_markdown": "新增有效题", "source_page": 1, "correct_bool": True, "_repair_attempted": False, "_validation_errors": []},
        ], "diagnostics": {"warnings": [], "invalid_count": 1}}

    monkeypatch.setattr(question_recognition, "parse_pdf", fake_parse_pdf)
    monkeypatch.setattr(question_recognition, "_save_crop", lambda *_args, **_kwargs: None)
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "局部预览", "description": ""}).json()
        current = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "true_false", "stem_markdown": "旧判断题", "explanation_markdown": "", "points": 2,
            "sort_order": 0, "reviewed": False, "correct_bool": True, "show_source_crop": False,
            "source_page": 1, "source_end_page": 1, "options": [], "blanks": [], "programming": None,
        }).json()
        with client.app.state.session_factory() as db:
            stored_set = db.get(QuestionSet, question_set["id"])
            asset = QuestionAsset(question_set_id=stored_set.id, storage_key="partial.pdf", original_name="partial.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
            db.add(asset); db.flush(); stored_set.source_pdf_asset_id = asset.id
            job = QuestionRecognitionJob(scope="set", status="processing", target_set_id=stored_set.id, source_asset_id=asset.id, target_fingerprint=set_fingerprint(stored_set))
            db.add(job); db.flush()
            result = asyncio.run(question_recognition._process_set_job(db, Settings(question_asset_dir=str(tmp_path / "assets")), job, asset))
        assert [item["status"] for item in result["changes"]] == ["invalid", "added"]
        assert result["changes"][0]["question_id"] == current["id"]
        assert result["changes"][0]["validation_errors"] == ["判断题缺少明确的正确答案"]
        assert result["diagnostics"]["invalid_count"] == 1


def test_fill_blank_lifecycle_review_and_source_image_replacement(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        create_child(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "填空练习", "description": ""}).json()
        payload = {
            "type": "fill_blank", "stem_markdown": "{{1}} 使用 {{2}} 输出内容。", "explanation_markdown": "Python 使用 print。",
            "points": 4, "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": True,
            "options": [], "blanks": [
                {"position": 1, "accepted_answers": ["Python", "python"]},
                {"position": 2, "accepted_answers": ["print"]},
            ], "programming": None,
        }
        created = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json=payload)
        assert created.status_code == 201, created.text
        question_id = created.json()["id"]

        updated = client.put(f"/api/admin/questions/{question_id}", json={**payload, "reviewed": True, "explanation_markdown": "已修改"})
        assert updated.status_code == 200 and updated.json()["reviewed"] is False
        reviewed = client.patch(f"/api/admin/questions/{question_id}/review", json={"reviewed": True})
        assert reviewed.status_code == 200 and reviewed.json()["reviewed"] is True

        png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")
        image = client.put(f"/api/admin/questions/{question_id}/source-image", files={"file": ("replacement.png", png, "image/png")})
        assert image.status_code == 200, image.text
        source_asset_id = image.json()["source_asset_id"]
        assert source_asset_id and image.json()["reviewed"] is False
        stem_image = client.put(f"/api/admin/questions/{question_id}/stem-image", files={"file": ("diagram.png", png, "image/png")})
        assert stem_image.status_code == 200, stem_image.text
        stem_asset_id = stem_image.json()["stem_image_asset_id"]
        assert stem_asset_id and stem_asset_id != source_asset_id
        assert stem_image.json()["source_asset_id"] == source_asset_id
        assert stem_image.json()["reviewed"] is False
        assert client.patch(f"/api/admin/questions/{question_id}/review", json={"reviewed": True}).status_code == 200
        assert client.post(f"/api/admin/question-sets/{question_set['id']}/publish").status_code == 200

        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [question_set["id"]], "counts": {}}).json()
        item = session["items"][0]
        assert item["question"]["stem_image_asset_id"] == stem_asset_id
        assert client.get(f"/api/question-assets/{stem_asset_id}").status_code == 200
        assert "accepted_answers" not in item["question"]["blanks"][0]
        saved = client.post(f"/api/exercises/sessions/{session['id']}/answers/{item['id']}", json={
            "selected_option_ids": [], "bool_answer": None, "blank_answers": [" Python ", "print"], "code": "",
        })
        assert saved.status_code == 200
        assert client.post(f"/api/exercises/sessions/{session['id']}/submit").json()["status"] == "completed"
        result = client.get(f"/api/exercises/sessions/{session['id']}/result").json()
        assert result["score"] == 4
        assert result["items"][0]["answer"]["details"]["blank_correct"] == [True, True]
        assert result["items"][0]["question"]["blanks"][0]["accepted_answers"] == ["Python", "python"]

        client.post("/api/auth/logout")
        admin_login(client)
        assert client.post(f"/api/admin/question-sets/{question_set['id']}/unpublish").status_code == 200
        removed = client.delete(f"/api/admin/questions/{question_id}/stem-image")
        assert removed.status_code == 200 and removed.json()["stem_image_asset_id"] is None
        assert removed.json()["source_asset_id"] == source_asset_id
        child_login(client)
        assert client.get(f"/api/question-assets/{stem_asset_id}").status_code == 200


def test_reference_output_requires_stable_preview_and_explicit_apply(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "输出预览", "description": ""}).json()
        question = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "输出两倍。", "explanation_markdown": "", "points": 10,
            "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [], "blanks": [],
            "programming": {
                "input_markdown": "整数", "output_markdown": "两倍", "constraints_markdown": "", "starter_code": "",
                "reference_solution": "print(int(input()) * 2)", "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [{"input_data": "3\n", "expected_output": "old\n", "is_sample": False, "weight": 10, "confirmed": True, "note": ""}],
            },
        }).json()
        queued = client.post(f"/api/admin/questions/{question['id']}/reference-output").json()
        incoming = tmp_path / "judge" / "incoming" / f"{queued['job_id']}.json"
        job = json.loads(incoming.read_text(encoding="utf-8"))
        case_id = job["cases"][0]["id"]
        outgoing = tmp_path / "judge" / "outgoing"
        outgoing.mkdir(parents=True, exist_ok=True)
        (outgoing / f"{queued['job_id']}.json").write_text(json.dumps({
            "job_id": queued["job_id"], "kind": "reference", "status": "complete", "question_id": question["id"],
            "fingerprint": job["fingerprint"], "cases": [{"id": case_id, "status": "AC", "stable": True, "stdout": "6\n", "stderr": "", "runs": []}],
        }), encoding="utf-8")

        preview = client.get(f"/api/admin/reference-output/{queued['job_id']}").json()
        assert preview["stale"] is False
        assert preview["cases"][0]["current_output"] == "old\n"
        assert preview["cases"][0]["candidate_output"] == "6\n"
        unchanged = client.get(f"/api/admin/question-sets/{question_set['id']}").json()
        assert unchanged["questions"][0]["programming"]["cases"][0]["expected_output"] == "old\n"

        applied = client.post(f"/api/admin/reference-output/{queued['job_id']}/apply", json={"case_ids": [case_id]})
        assert applied.status_code == 200, applied.text
        saved = applied.json()["question"]
        assert saved["programming"]["cases"][0]["expected_output"] == "6\n"
        assert saved["programming"]["cases"][0]["confirmed"] is False
        assert saved["reviewed"] is False


def test_objective_set_submission_hides_answers_and_drives_wrong_book(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        child_id = create_child(client)
        set_id, single_id, _ = create_objective_set(client)
        child_login(client)

        listed = client.get("/api/exercises/question-sets").json()
        assert listed[0]["id"] == set_id
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}})
        assert session.status_code == 201
        body = session.json()
        assert body["max_score"] == 4
        assert "correct" not in body["items"][0]["question"]["options"][0]
        assert body["items"][0]["question"]["explanation_markdown"] == ""

        first, second = body["items"]
        wrong_option = first["question"]["options"][0]["id"]
        client.patch(f"/api/exercises/sessions/{body['id']}/answers/{first['id']}", json={"selected_option_ids": [wrong_option], "bool_answer": None, "code": ""})
        client.patch(f"/api/exercises/sessions/{body['id']}/answers/{second['id']}", json={"selected_option_ids": [], "bool_answer": True, "code": ""})
        submitted = client.post(f"/api/exercises/sessions/{body['id']}/submit")
        assert submitted.json()["status"] == "completed"
        result = client.get(f"/api/exercises/sessions/{body['id']}/result").json()
        assert result["score"] == 2
        assert result["items"][0]["question"]["explanation_markdown"]
        assert any(option.get("correct") for option in result["items"][0]["question"]["options"])
        assert client.get("/api/exercises/wrong-questions").json()[0]["question_id"] == single_id

        retry = client.post("/api/exercises/sessions", json={"mode": "wrong", "question_set_ids": [], "counts": {}}).json()
        correct_option = next(option["id"] for option in retry["items"][0]["question"]["options"] if option["content_markdown"] == "input")
        client.patch(f"/api/exercises/sessions/{retry['id']}/answers/{retry['items'][0]['id']}", json={"selected_option_ids": [correct_option], "bool_answer": None, "code": ""})
        client.post(f"/api/exercises/sessions/{retry['id']}/submit")
        assert client.get("/api/exercises/wrong-questions").json() == []

        in_progress = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}})
        assert in_progress.status_code == 201
        client.post("/api/auth/logout")
        admin_login(client)
        report = client.get(f"/api/admin/exercise-reports/summary?days=30&child_id={child_id}").json()
        assert report["session_count"] == 2
        assert report["total_session_count"] == 3
        assert report["status_counts"] == {"in_progress": 1, "judging": 0, "completed": 2, "abandoned": 0}
        assert report["completion_rate"] == 66.7
        assert report["average_percent"] == 75.0
        assert report["unresolved_wrong_count"] == 0


def test_active_session_can_resume_and_abandon_before_starting_another(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        child_id = create_child(client)
        other = client.post("/api/admin/children", json={"name": "小雨", "pin": "5678", "active": True}).json()
        set_id, _, _ = create_objective_set(client)
        child_login(client)

        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}}).json()
        assert session["current_item_sort_order"] == 0
        first = session["items"][0]
        second = session["items"][1]
        moved = client.patch(f"/api/exercises/sessions/{session['id']}/position", json={"session_item_id": second["id"]})
        assert moved.status_code == 200
        assert moved.json() == {"session_item_id": second["id"], "sort_order": second["sort_order"]}
        assert client.get(f"/api/exercises/sessions/{session['id']}").json()["current_item_sort_order"] == second["sort_order"]
        assert client.patch(f"/api/exercises/sessions/{session['id']}/position", json={"session_item_id": 999999}).status_code == 404
        option_id = first["question"]["options"][0]["id"]
        assert client.patch(f"/api/exercises/sessions/{session['id']}/answers/{first['id']}", json={
            "selected_option_ids": [option_id], "bool_answer": None, "code": "",
        }).status_code == 200

        active = client.get("/api/exercises/active-sessions").json()
        assert [(item["id"], item["answered_count"], item["total_count"]) for item in active] == [(session["id"], 1, 2)]
        assert active[0]["last_activity_at"] >= active[0]["created_at"]

        duplicate = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}})
        assert duplicate.status_code == 409
        assert duplicate.json()["detail"]["active_sessions"][0]["id"] == session["id"]

        client.post("/api/auth/logout")
        assert client.post("/api/auth/child/login", json={"name": "小雨", "pin": "5678"}).status_code == 200
        assert client.post(f"/api/exercises/sessions/{session['id']}/abandon").status_code == 404
        assert client.patch(f"/api/exercises/sessions/{session['id']}/position", json={"session_item_id": second["id"]}).status_code == 404
        client.post("/api/auth/logout")
        assert client.post("/api/auth/child/login", json={"name": "小宇", "pin": "1234"}).status_code == 200

        abandoned = client.post(f"/api/exercises/sessions/{session['id']}/abandon")
        assert abandoned.json()["status"] == "abandoned"
        assert client.patch(f"/api/exercises/sessions/{session['id']}/position", json={"session_item_id": second["id"]}).status_code == 409
        assert client.post(f"/api/exercises/sessions/{session['id']}/abandon").json()["status"] == "abandoned"
        assert client.get("/api/exercises/active-sessions").json() == []
        stored = client.get(f"/api/exercises/sessions/{session['id']}").json()
        assert stored["status"] == "abandoned"
        assert "correct" not in stored["items"][0]["question"]["options"][0]

        replacement = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}})
        assert replacement.status_code == 201
        client.post("/api/auth/logout")
        admin_login(client)
        report = client.get(f"/api/admin/exercise-reports/summary?days=30&child_id={child_id}").json()
        assert report["total_session_count"] == 2
        assert report["completion_rate"] == 0
        assert report["status_counts"]["abandoned"] == 1
        assert report["status_counts"]["in_progress"] == 1
        unified_csv = client.get(f"/api/admin/reports/export.csv?view=exercise&days=30&child_id={child_id}")
        compatible_csv = client.get(f"/api/admin/exercise-reports/export.csv?days=30&child_id={child_id}")
        assert "abandoned" in unified_csv.content.decode("utf-8-sig")
        assert "abandoned" in compatible_csv.content.decode("utf-8-sig")


def test_concurrent_first_answer_saves_are_idempotent(tmp_path, monkeypatch):
    with make_client(tmp_path) as client:
        admin_login(client)
        create_child(client)
        set_id, _, _ = create_objective_set(client)
        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}}).json()
        item = session["items"][0]
        option_id = item["question"]["options"][0]["id"]
        path = f"/api/exercises/sessions/{session['id']}/answers/{item['id']}"
        payload = {"selected_option_ids": [option_id], "bool_answer": None, "code": ""}

        original_owned_session = exercises_router._owned_session
        simultaneous = threading.Barrier(2)

        def synchronized_owned_session(db, session_id, child_id):
            result = original_owned_session(db, session_id, child_id)
            simultaneous.wait(timeout=5)
            return result

        monkeypatch.setattr(exercises_router, "_owned_session", synchronized_owned_session)
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _: client.post(path, json=payload), range(2)))
        monkeypatch.setattr(exercises_router, "_owned_session", original_owned_session)

        assert [response.status_code for response in responses] == [200, 200]
        with client.app.state.session_factory() as db:
            answers = db.scalars(select(ExerciseAnswer).where(ExerciseAnswer.session_item_id == item["id"])).all()
            assert len(answers) == 1


def test_admin_can_reset_one_students_learning_data_without_touching_profile_or_libraries(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        child_id = create_child(client)
        other_id = client.post("/api/admin/children", json={"name": "小雨", "pin": "5678", "active": True}).json()["id"]
        set_id, question_id, _ = create_objective_set(client)

        with client.app.state.session_factory() as db:
            word_set = WordSet(title="重置测试词库", description="公共词库", active=True)
            word = Word(word_set=word_set, spelling="reset", normalized_spelling="reset", enrichment_status="complete")
            db.add(word_set)
            db.flush()

            typing_attempt = PracticeAttempt(
                child_id=child_id, prompt_snapshot="asdf", duration_ms=60000, char_count=80,
                speed_char_count=80, metric_version=1, error_count=1, cpm=80, accuracy=98.8,
                errors=[AttemptError(expected_char="a", actual_char="s", count=1)],
            )
            word_attempt = PracticeAttempt(
                child_id=child_id, word_set_id=word_set.id, word_id=word.id, prompt_snapshot="reset",
                duration_ms=30000, char_count=25, speed_char_count=25, metric_version=1,
                error_count=1, cpm=50, accuracy=96,
                errors=[AttemptError(expected_char="e", actual_char="r", count=1)],
            )
            other_attempt = PracticeAttempt(
                child_id=other_id, prompt_snapshot="keep", duration_ms=30000, char_count=30,
                speed_char_count=30, metric_version=1, error_count=0, cpm=60, accuracy=100,
            )
            db.add_all([typing_attempt, word_attempt, other_attempt])

            target_sessions = []
            for index, status in enumerate(("in_progress", "judging", "completed", "abandoned")):
                target_sessions.append(ExerciseSession(
                    child_id=child_id, mode="set", status=status, title=f"待删除 {status}",
                    config_json="{}", score=1 if status == "completed" else 0, max_score=2,
                    items=[ExerciseSessionItem(
                        question_id=question_id, question_set_id=set_id, sort_order=0, points=2,
                        snapshot_json="{}", answer=ExerciseAnswer(answer_json="{}", status="answered"),
                    )],
                ))
            other_session = ExerciseSession(
                child_id=other_id, mode="set", status="completed", title="保留练习",
                config_json="{}", score=2, max_score=2,
            )
            db.add_all([*target_sessions, other_session])
            db.add_all([
                WrongQuestion(child_id=child_id, question_id=question_id, wrong_count=2, mastered=False),
                WrongQuestion(child_id=other_id, question_id=question_id, wrong_count=1, mastered=True),
            ])
            db.commit()
            attempt_ids = [typing_attempt.id, word_attempt.id]
            error_ids = [error.id for attempt in (typing_attempt, word_attempt) for error in attempt.errors]
            session_ids = [session.id for session in target_sessions]
            item_ids = [session.items[0].id for session in target_sessions]
            answer_ids = [session.items[0].answer.id for session in target_sessions]
            word_set_id = word_set.id

        missing = client.post("/api/admin/children/99999/reset-learning-data", json={"confirm_name": "不存在"})
        assert missing.status_code == 404
        mismatch = client.post(f"/api/admin/children/{child_id}/reset-learning-data", json={"confirm_name": "小雨"})
        assert mismatch.status_code == 409

        with client.app.state.session_factory() as db:
            assert len(db.scalars(select(PracticeAttempt).where(PracticeAttempt.child_id == child_id)).all()) == 2
            assert len(db.scalars(select(ExerciseSession).where(ExerciseSession.child_id == child_id)).all()) == 4
            assert len(db.scalars(select(WrongQuestion).where(WrongQuestion.child_id == child_id)).all()) == 1

        child_login(client)
        forbidden = client.post(f"/api/admin/children/{child_id}/reset-learning-data", json={"confirm_name": "小宇"})
        assert forbidden.status_code == 403
        client.post("/api/auth/logout")
        admin_login(client)

        reset = client.post(f"/api/admin/children/{child_id}/reset-learning-data", json={"confirm_name": "  小宇  "})
        assert reset.status_code == 200
        assert reset.json() == {
            "child_id": child_id,
            "practice_attempts": 2,
            "exercise_sessions": 4,
            "wrong_questions": 1,
        }

        with client.app.state.session_factory() as db:
            assert db.get(ChildProfile, child_id) is not None
            assert db.get(QuestionSet, set_id) is not None
            assert db.get(WordSet, word_set_id) is not None
            assert all(db.get(PracticeAttempt, record_id) is None for record_id in attempt_ids)
            assert all(db.get(AttemptError, record_id) is None for record_id in error_ids)
            assert all(db.get(ExerciseSession, record_id) is None for record_id in session_ids)
            assert all(db.get(ExerciseSessionItem, record_id) is None for record_id in item_ids)
            assert all(db.get(ExerciseAnswer, record_id) is None for record_id in answer_ids)
            assert db.scalars(select(WrongQuestion).where(WrongQuestion.child_id == child_id)).all() == []
            assert len(db.scalars(select(PracticeAttempt).where(PracticeAttempt.child_id == other_id)).all()) == 1
            assert len(db.scalars(select(ExerciseSession).where(ExerciseSession.child_id == other_id)).all()) == 1
            assert len(db.scalars(select(WrongQuestion).where(WrongQuestion.child_id == other_id)).all()) == 1

        repeated = client.post(f"/api/admin/children/{child_id}/reset-learning-data", json={"confirm_name": "小宇"})
        assert repeated.status_code == 200
        assert repeated.json() == {
            "child_id": child_id,
            "practice_attempts": 0,
            "exercise_sessions": 0,
            "wrong_questions": 0,
        }

        child_login(client)
        replacement = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}})
        assert replacement.status_code == 201


def test_structured_exercise_import_previews_commits_and_rejects_non_draft_append(tmp_path):
    content = """题套：基础判断
类型：判断题
题目：Python 区分大小写。
答案：正确
分值：2"""
    with make_client(tmp_path) as client:
        admin_login(client)
        preview = client.post("/api/admin/exercise-import/preview", json={"format": "txt", "content": content, "mode": "create"})
        assert preview.status_code == 200
        assert preview.json()["valid"] is True
        assert preview.json()["counts"]["true_false"] == 1

        committed = client.post("/api/admin/exercise-import", json={"format": "txt", "content": content, "mode": "create"})
        assert committed.status_code == 200
        imported_id = committed.json()["question_set_ids"][0]
        imported = client.get(f"/api/admin/question-sets/{imported_id}").json()
        assert imported["status"] == "draft"
        assert imported["questions"][0]["reviewed"] is False

        assert client.post(f"/api/admin/question-sets/{imported_id}/archive").status_code == 200
        blocked = client.post("/api/admin/exercise-import", json={"format": "txt", "content": content, "mode": "append", "target_question_set_id": imported_id})
        assert blocked.status_code == 409


def test_random_session_validates_availability(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client); create_child(client)
        set_id, _, _ = create_objective_set(client)
        child_login(client)
        too_many = client.post("/api/exercises/sessions", json={"mode": "random", "question_set_ids": [set_id], "counts": {"single_choice": 2}})
        assert too_many.status_code == 422
        valid = client.post("/api/exercises/sessions", json={"mode": "random", "question_set_ids": [set_id], "counts": {"single_choice": 1, "true_false": 1}})
        assert valid.status_code == 201
        assert len(valid.json()["items"]) == 2


def test_python_syntax_check_parses_without_executing_and_returns_diagnostics(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client); create_child(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "语法练习", "description": ""}).json()
        question = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "编写程序。", "explanation_markdown": "",
            "points": 10, "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [],
            "programming": {
                "input_markdown": "无", "output_markdown": "无", "constraints_markdown": "", "starter_code": "", "reference_solution": "print(1)",
                "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [
                    {"input_data": "", "expected_output": "1\n", "is_sample": True, "weight": 0, "confirmed": False, "note": ""},
                    {"input_data": "", "expected_output": "1\n", "is_sample": False, "weight": 10, "confirmed": True, "note": ""},
                ],
            },
        })
        assert question.status_code == 201
        assert client.post(f"/api/admin/question-sets/{question_set['id']}/publish").status_code == 200
        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [question_set["id"]], "counts": {}}).json()
        item_id = session["items"][0]["id"]
        path = f"/api/exercises/sessions/{session['id']}/syntax-check"

        marker = tmp_path / "syntax-check-must-not-run"
        valid = client.post(path, json={"session_item_id": item_id, "code": f'名字 = "小宇"\nopen(r"{marker}", "w").write(名字)'})
        assert valid.status_code == 200
        assert valid.json() == {"valid": True, "diagnostics": []}
        assert not marker.exists()
        assert client.post(path, json={"session_item_id": item_id, "code": ""}).json()["valid"] is True

        missing_colon = client.post(path, json={"session_item_id": item_id, "code": "if True\n    print(1)"})
        assert missing_colon.status_code == 200
        diagnostic = missing_colon.json()["diagnostics"][0]
        assert diagnostic["code"] == "SyntaxError"
        assert diagnostic["message"] == "此处缺少冒号（:）"
        assert diagnostic["line"] == 1 and diagnostic["column"] > 0
        assert diagnostic["end_line"] >= diagnostic["line"] and diagnostic["end_column"] > diagnostic["column"]

        indentation = client.post(path, json={"session_item_id": item_id, "code": "if True:\nprint(1)"}).json()["diagnostics"][0]
        assert indentation["code"] == "IndentationError"
        assert "缩进" in indentation["message"]
        tab_error = client.post(path, json={"session_item_id": item_id, "code": "if True:\n\tprint(1)\n        print(2)"}).json()["diagnostics"][0]
        assert tab_error["code"] == "TabError"
        assert "Tab 和空格" in tab_error["message"]
        unclosed = client.post(path, json={"session_item_id": item_id, "code": "print((1 + 2)"}).json()["diagnostics"][0]
        assert "闭合" in unclosed["message"]
        assert client.post(path, json={"session_item_id": item_id, "code": "x" * 100001}).status_code == 422

        format_path = f"/api/exercises/sessions/{session['id']}/format-code"
        format_marker = tmp_path / "format-code-must-not-run"
        unformatted = f'名字={{"值":1}}\nopen(r"{format_marker}","w").write("不会执行")'
        formatted = client.post(format_path, json={"session_item_id": item_id, "code": unformatted})
        assert formatted.status_code == 200
        assert formatted.json()["valid"] is True
        assert formatted.json()["changed"] is True
        assert formatted.json()["formatted_code"].startswith('名字 = {"值": 1}\n')
        assert not format_marker.exists()
        unchanged = client.post(format_path, json={"session_item_id": item_id, "code": formatted.json()["formatted_code"]}).json()
        assert unchanged["valid"] is True and unchanged["changed"] is False
        invalid_format = client.post(format_path, json={"session_item_id": item_id, "code": "if True\n print(1)"}).json()
        assert invalid_format["valid"] is False
        assert invalid_format["formatted_code"] == "if True\n print(1)"
        assert invalid_format["diagnostics"][0]["code"] == "SyntaxError"
        assert client.post(format_path, json={"session_item_id": item_id, "code": "x" * 100001}).status_code == 422


def test_python_syntax_check_enforces_session_ownership_status_and_question_type(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client); create_child(client)
        objective_set_id, _, _ = create_objective_set(client)
        programming_set = client.post("/api/admin/question-sets", json={"title": "受限语法练习", "description": ""}).json()
        programming = client.post(f"/api/admin/question-sets/{programming_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "输出 1。", "explanation_markdown": "", "points": 10,
            "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [],
            "programming": {
                "input_markdown": "无", "output_markdown": "1", "constraints_markdown": "", "starter_code": "", "reference_solution": "print(1)",
                "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [
                    {"input_data": "", "expected_output": "1\n", "is_sample": True, "weight": 0, "confirmed": False, "note": ""},
                    {"input_data": "", "expected_output": "1\n", "is_sample": False, "weight": 10, "confirmed": True, "note": ""},
                ],
            },
        })
        assert programming.status_code == 201
        assert client.post(f"/api/admin/question-sets/{programming_set['id']}/publish").status_code == 200
        child_login(client)
        program_session = client.post("/api/exercises/sessions", json={
            "mode": "random", "question_set_ids": [objective_set_id, programming_set["id"]],
            "counts": {"single_choice": 1, "programming": 1},
        }).json()
        program_item = next(item for item in program_session["items"] if item["question"]["type"] == "programming")
        objective_item = next(item for item in program_session["items"] if item["question"]["type"] == "single_choice")
        syntax_payload = {"session_item_id": program_item["id"], "code": "print(1)"}

        wrong_type = client.post(f"/api/exercises/sessions/{program_session['id']}/syntax-check", json={
            "session_item_id": objective_item["id"], "code": "print(1)",
        })
        assert wrong_type.status_code == 404
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/format-code", json={
            "session_item_id": objective_item["id"], "code": "print(1)",
        }).status_code == 404

        client.post("/api/auth/logout")
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/syntax-check", json=syntax_payload).status_code == 401
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/format-code", json=syntax_payload).status_code == 401
        admin_login(client)
        assert client.post("/api/admin/children", json={"name": "小明", "pin": "5678", "active": True}).status_code == 201
        client.post("/api/auth/logout")
        assert client.post("/api/auth/child/login", json={"name": "小明", "pin": "5678"}).status_code == 200
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/syntax-check", json=syntax_payload).status_code == 404
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/format-code", json=syntax_payload).status_code == 404

        client.post("/api/auth/logout"); child_login(client)
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/abandon").status_code == 200
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/syntax-check", json=syntax_payload).status_code == 409
        assert client.post(f"/api/exercises/sessions/{program_session['id']}/format-code", json=syntax_payload).status_code == 409


def test_python_completion_endpoints_are_scoped_and_forward_to_pyright(tmp_path):
    class FakePyright:
        def __init__(self):
            self.complete_calls = []
            self.resolve_calls = []

        async def complete(self, **kwargs):
            self.complete_calls.append(kwargs)
            return {"available": True, "items": [{
                "id": "completion-token", "label": "append", "type": "method", "detail": "append(object: T)",
                "documentation": "", "documentation_format": "plaintext", "insert_text": "append", "insert_text_format": 1,
                "filter_text": "append", "sort_text": "append", "replace": None,
            }]}

        async def resolve(self, **kwargs):
            self.resolve_calls.append(kwargs)
            return {"available": True, "detail": "append(object: T)", "documentation": "在列表末尾添加一个元素。", "documentation_format": "markdown"}

        async def close(self):
            return None

    with make_client(tmp_path) as client:
        admin_login(client); create_child(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "补全练习", "description": ""}).json()
        question = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "编写程序。", "explanation_markdown": "", "points": 10,
            "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [],
            "programming": {
                "input_markdown": "无", "output_markdown": "无", "constraints_markdown": "", "starter_code": "", "reference_solution": "print(1)",
                "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [
                    {"input_data": "", "expected_output": "1\n", "is_sample": True, "weight": 0, "confirmed": False, "note": ""},
                    {"input_data": "", "expected_output": "1\n", "is_sample": False, "weight": 10, "confirmed": True, "note": ""},
                ],
            },
        })
        assert question.status_code == 201
        assert client.post(f"/api/admin/question-sets/{question_set['id']}/publish").status_code == 200
        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [question_set["id"]], "counts": {}}).json()
        item_id = session["items"][0]["id"]
        fake = FakePyright()
        client.app.state.pyright_service = fake
        path = f"/api/exercises/sessions/{session['id']}/python-completions"

        completion = client.post(path, json={
            "session_item_id": item_id,
            "code": "vals = []\nvals.",
            "position": {"line": 1, "character": 5},
            "trigger_character": ".",
        })
        assert completion.status_code == 200
        assert completion.json()["items"][0]["label"] == "append"
        assert fake.complete_calls[0]["child_id"] > 0
        assert fake.complete_calls[0]["session_item_id"] == item_id
        assert fake.complete_calls[0]["trigger_character"] == "."

        resolved = client.post(f"{path}/resolve", json={"session_item_id": item_id, "completion_id": "completion-token"})
        assert resolved.status_code == 200
        assert "列表末尾" in resolved.json()["documentation"]
        assert resolved.json()["documentation_format"] == "markdown"
        assert fake.resolve_calls[0]["session_id"] == session["id"]

        assert client.post(path, json={
            "session_item_id": item_id, "code": "x" * 100001,
            "position": {"line": 0, "character": 1}, "trigger_character": None,
        }).status_code == 422
        client.post("/api/auth/logout")
        assert client.post(path, json={
            "session_item_id": item_id, "code": "vals.",
            "position": {"line": 0, "character": 5}, "trigger_character": ".",
        }).status_code == 401


def test_programming_submission_uses_queue_and_weighted_result(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client); create_child(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "编程练习", "description": ""}).json()
        question = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "输入两个整数，输出和。", "explanation_markdown": "使用加法。",
            "points": 25, "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [],
            "programming": {
                "input_markdown": "两个整数", "output_markdown": "一个整数", "constraints_markdown": "均为正整数",
                "starter_code": "", "reference_solution": "a,b=map(int,input().split());print(a+b)", "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [
                    {"input_data": "1 2\n", "expected_output": "3\n", "is_sample": True, "weight": 0, "confirmed": False, "note": "", "explanation_markdown": "将 $1+2$ 相加。"},
                    {"input_data": "10 20\n", "expected_output": "30\n", "is_sample": False, "weight": 10, "confirmed": True, "note": "边界一", "explanation_markdown": "不得公开"},
                    {"input_data": "2 3\n", "expected_output": "5\n", "is_sample": False, "weight": 15, "confirmed": True, "note": "边界二", "explanation_markdown": "仍不得公开"},
                ],
            },
        })
        assert question.status_code == 201
        assert client.post(f"/api/admin/question-sets/{question_set['id']}/publish").status_code == 200
        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [question_set["id"]], "counts": {}}).json()
        program = session["items"][0]["question"]["programming"]
        assert program["reference_solution"] == ""
        assert all(case["is_sample"] for case in program["cases"])
        assert program["cases"][0]["explanation_markdown"] == "将 $1+2$ 相加。"
        item = session["items"][0]
        sample_run = client.post(f"/api/exercises/sessions/{session['id']}/sample-runs", json={
            "session_item_id": item["id"],
            "code": "a,b=map(int,input().split());print(a+b)",
        })
        assert sample_run.status_code == 202
        sample_job_path = next((tmp_path / "judge" / "incoming").glob("*.json"))
        sample_job = json.loads(sample_job_path.read_text(encoding="utf-8"))
        assert sample_job["kind"] == "sample"
        assert sample_job["cases"] == [{"id": program["cases"][0]["id"], "input": "1 2\n", "expected": "3\n", "weight": 0}]
        sample_job_path.unlink()
        client.patch(f"/api/exercises/sessions/{session['id']}/answers/{item['id']}", json={"selected_option_ids": [], "bool_answer": None, "code": "a,b=map(int,input().split());print(a+b)"})
        assert client.post(f"/api/exercises/sessions/{session['id']}/submit").json()["status"] == "judging"

        judging = client.get(f"/api/exercises/sessions/{session['id']}").json()
        assert judging["status"] == "judging"
        assert all(case["is_sample"] for case in judging["items"][0]["question"]["programming"]["cases"])
        assert "details" not in judging["items"][0]["answer"]

        incoming = next((tmp_path / "judge" / "incoming").glob("*.json"))
        job = json.loads(incoming.read_text(encoding="utf-8"))
        assert job["cases"][0]["input"] == "10 20\n"
        assert [case["weight"] for case in job["cases"]] == [10, 15]
        outgoing = tmp_path / "judge" / "outgoing"
        outgoing.mkdir(parents=True, exist_ok=True)
        (outgoing / f"{job['job_id']}.json").write_text(json.dumps({
            "job_id": job["job_id"], "status": "complete", "cases": [
                {"id": job["cases"][0]["id"], "status": "AC", "duration_ms": 4, "weight": 10, "stdout": "30\n", "stderr": ""},
                {"id": job["cases"][1]["id"], "status": "WA", "duration_ms": 5, "weight": 15, "stdout": "6\n", "stderr": "debug\n"},
            ],
        }), encoding="utf-8")
        result = client.get(f"/api/exercises/sessions/{session['id']}/result").json()
        assert result["status"] == "completed"
        assert result["score"] == 10
        hidden_results = [case for case in result["items"][0]["question"]["programming"]["cases"] if not case["is_sample"]]
        assert [(case["input_data"], case["expected_output"], case["weight"]) for case in hidden_results] == [("10 20\n", "30\n", 10), ("2 3\n", "5\n", 15)]
        assert all("note" not in case and "confirmed" not in case and "explanation_markdown" not in case for case in hidden_results)
        assert result["items"][0]["answer"]["details"] == {
            "cases": [
                {"id": job["cases"][0]["id"], "status": "AC", "duration_ms": 4, "weight": 10, "stdout": "30\n", "stderr": ""},
                {"id": job["cases"][1]["id"], "status": "WA", "duration_ms": 5, "weight": 15, "stdout": "6\n", "stderr": "debug\n"},
            ],
            "passed": 1,
            "total": 2,
        }


def test_programming_set_cannot_publish_with_empty_sample_placeholder(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        question_set = client.post("/api/admin/question-sets", json={"title": "空样例", "description": ""}).json()
        question = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json={
            "type": "programming", "stem_markdown": "输出结果。", "explanation_markdown": "",
            "points": 10, "sort_order": 0, "reviewed": True, "correct_bool": None, "show_source_crop": False, "options": [],
            "programming": {
                "input_markdown": "一个数字", "output_markdown": "一个数字", "constraints_markdown": "",
                "starter_code": "", "reference_solution": "print(input())", "time_limit_ms": 1000, "memory_limit_mb": 128,
                "cases": [
                    {"input_data": "", "expected_output": "", "is_sample": True, "weight": 0, "confirmed": False, "note": ""},
                    {"input_data": "1\n", "expected_output": "1\n", "is_sample": False, "weight": 10, "confirmed": True, "note": ""},
                ],
            },
        })
        assert question.status_code == 201
        published = client.post(f"/api/admin/question-sets/{question_set['id']}/publish")
        assert published.status_code == 422
        assert "存在空的公开样例" in "".join(published.json()["detail"]["errors"])


def test_pdf_import_requires_separate_model_configuration(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        response = client.post("/api/admin/question-imports", files={"file": ("paper.pdf", b"%PDF-1.7\n", "application/pdf")})
        assert response.status_code == 409
        assert "PDF 识别模型" in response.json()["detail"]


def test_import_api_returns_structured_diagnostics(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        with client.app.state.session_factory() as db:
            asset = QuestionAsset(storage_key="paper.pdf", original_name="paper.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=10)
            db.add(asset)
            db.flush()
            db.add(QuestionImportJob(
                source_asset_id=asset.id,
                status="ready",
                page_count=5,
                diagnostics_json=json.dumps({
                    "warnings": ["第 4 页需要核对"],
                    "counts": {"single_choice": 15, "true_false": 10, "programming": 2},
                    "retried_pages": [4],
                }, ensure_ascii=False),
            ))
            db.commit()
        result = client.get("/api/admin/question-imports").json()[0]
        assert result["warnings"] == ["第 4 页需要核对"]
        assert result["counts"]["programming"] == 2
        assert result["retried_pages"] == [4]
        assert result["source_filename"] == "paper.pdf"
        assert result["question_count"] == 27


def test_question_set_and_question_reordering_controls_student_order(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        create_child(client)
        first_set, _, _ = create_objective_set(client)
        second_set, _, _ = create_objective_set(client)

        duplicate = client.put("/api/admin/question-sets/order", json={"question_set_ids": [second_set, second_set]})
        assert duplicate.status_code == 409
        reordered = client.put("/api/admin/question-sets/order", json={"question_set_ids": [second_set, first_set]})
        assert reordered.status_code == 200
        assert [item["id"] for item in client.get("/api/admin/question-sets").json()] == [second_set, first_set]

        second_questions = client.get(f"/api/admin/question-sets/{second_set}").json()["questions"]
        question_ids = [item["id"] for item in second_questions]
        blocked = client.put(f"/api/admin/question-sets/{second_set}/questions/order", json={"question_ids": question_ids[::-1]})
        assert blocked.status_code == 409
        assert client.post(f"/api/admin/question-sets/{second_set}/unpublish").status_code == 200
        moved = client.put(f"/api/admin/question-sets/{second_set}/questions/order", json={"question_ids": question_ids[::-1]})
        assert moved.status_code == 200
        assert [item["id"] for item in client.get(f"/api/admin/question-sets/{second_set}").json()["questions"]] == question_ids[::-1]

        assert client.post(f"/api/admin/question-sets/{second_set}/publish").status_code == 200
        child_login(client)
        assert [item["id"] for item in client.get("/api/exercises/question-sets").json()] == [second_set, first_set]


def test_deleting_draft_set_removes_library_resources_but_keeps_session_snapshot(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        create_child(client)
        set_id, _, _ = create_objective_set(client)
        asset_root = tmp_path / "assets"
        asset_root.mkdir(parents=True, exist_ok=True)
        asset_path = asset_root / "source-paper.pdf"
        asset_path.write_bytes(b"%PDF-1.7\n")
        with client.app.state.session_factory() as db:
            asset = QuestionAsset(question_set_id=set_id, storage_key=asset_path.name, original_name="paper.pdf", mime_type="application/pdf", kind="source_pdf", size_bytes=9)
            db.add(asset)
            db.flush()
            question_set = db.get(QuestionSet, set_id)
            question_set.source_pdf_asset_id = asset.id
            job = QuestionImportJob(source_asset_id=asset.id, question_set_id=set_id, status="ready", page_count=1)
            db.add(job)
            db.commit()
            asset_id, job_id = asset.id, job.id

        child_login(client)
        session = client.post("/api/exercises/sessions", json={"mode": "set", "question_set_ids": [set_id], "counts": {}}).json()
        first, second = session["items"]
        wrong_option = first["question"]["options"][0]["id"]
        client.patch(f"/api/exercises/sessions/{session['id']}/answers/{first['id']}", json={"selected_option_ids": [wrong_option], "bool_answer": None, "code": ""})
        client.patch(f"/api/exercises/sessions/{session['id']}/answers/{second['id']}", json={"selected_option_ids": [], "bool_answer": True, "code": ""})
        assert client.post(f"/api/exercises/sessions/{session['id']}/submit").status_code == 202

        admin_login(client)
        assert client.delete(f"/api/admin/question-sets/{set_id}").status_code == 409
        assert client.post(f"/api/admin/question-sets/{set_id}/unpublish").status_code == 200
        assert client.delete(f"/api/admin/question-sets/{set_id}").status_code == 204
        assert not asset_path.exists()

        with client.app.state.session_factory() as db:
            assert db.get(QuestionSet, set_id) is None
            assert db.get(QuestionAsset, asset_id) is None
            assert db.get(QuestionImportJob, job_id) is None
            assert db.scalars(select(WrongQuestion)).all() == []
            stored = db.scalars(select(ExerciseSessionItem).where(ExerciseSessionItem.session_id == session["id"])).all()
            assert stored and all(item.question_id is None and item.question_set_id is None for item in stored)
            assert "Python 的输入函数是" in stored[0].snapshot_json
