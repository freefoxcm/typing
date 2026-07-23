import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.routers import exercises as exercises_router
from app.models import (
    AttemptError,
    ChildProfile,
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    PracticeAttempt,
    QuestionAsset,
    QuestionImportJob,
    QuestionSet,
    Word,
    WordSet,
    WrongQuestion,
)


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
        first = session["items"][0]
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
        client.post("/api/auth/logout")
        assert client.post("/api/auth/child/login", json={"name": "小宇", "pin": "1234"}).status_code == 200

        abandoned = client.post(f"/api/exercises/sessions/{session['id']}/abandon")
        assert abandoned.json()["status"] == "abandoned"
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
                error_count=1, cpm=80, accuracy=98.8,
                errors=[AttemptError(expected_char="a", actual_char="s", count=1)],
            )
            word_attempt = PracticeAttempt(
                child_id=child_id, word_set_id=word_set.id, word_id=word.id, prompt_snapshot="reset",
                duration_ms=30000, char_count=25, error_count=1, cpm=50, accuracy=96,
                errors=[AttemptError(expected_char="e", actual_char="r", count=1)],
            )
            other_attempt = PracticeAttempt(
                child_id=other_id, prompt_snapshot="keep", duration_ms=30000, char_count=30,
                error_count=0, cpm=60, accuracy=100,
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
                    {"input_data": "1 2\n", "expected_output": "3\n", "is_sample": True, "weight": 0, "confirmed": False, "note": ""},
                    {"input_data": "10 20\n", "expected_output": "30\n", "is_sample": False, "weight": 25, "confirmed": True, "note": ""},
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

        incoming = next((tmp_path / "judge" / "incoming").glob("*.json"))
        job = json.loads(incoming.read_text(encoding="utf-8"))
        assert job["cases"][0]["input"] == "10 20\n"
        assert job["cases"][0]["weight"] == 25
        outgoing = tmp_path / "judge" / "outgoing"
        outgoing.mkdir(parents=True, exist_ok=True)
        (outgoing / f"{job['job_id']}.json").write_text(json.dumps({
            "job_id": job["job_id"], "status": "complete", "cases": [{"id": job["cases"][0]["id"], "status": "AC", "duration_ms": 4, "weight": 25, "stdout": "30\n"}],
        }), encoding="utf-8")
        result = client.get(f"/api/exercises/sessions/{session['id']}/result").json()
        assert result["status"] == "completed"
        assert result["score"] == 25
        hidden_result = next(case for case in result["items"][0]["question"]["programming"]["cases"] if not case["is_sample"])
        assert "input_data" not in hidden_result and "expected_output" not in hidden_result
        assert result["items"][0]["answer"]["details"] == {"cases": [{"id": job["cases"][0]["id"], "status": "AC", "duration_ms": 4, "weight": 25}], "passed": 1, "total": 1}


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
