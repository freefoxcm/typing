import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.models import QuestionAsset, QuestionImportJob


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
        create_child(client)
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
