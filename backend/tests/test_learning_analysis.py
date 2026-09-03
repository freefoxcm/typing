import json
from datetime import datetime, timedelta
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.learning_analysis import _wrong_patterns
from app.models import (
    AttemptError,
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    PracticeAttempt,
    Question,
    QuestionSet,
    Word,
    WordSet,
    WrongQuestion,
)


def make_client(tmp_path: Path) -> TestClient:
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{tmp_path / 'analysis.db'}",
        admin_username="root",
        admin_password="correct-horse",
        session_secret="test-secret-with-enough-entropy",
        frontend_dist=str(tmp_path / "dist"),
        seed_demo_data=False,
    )))


def login(client: TestClient) -> None:
    assert client.post("/api/auth/admin/login", json={"username": "root", "password": "correct-horse"}).status_code == 200


def snapshot(question_id: int, kind: str = "single_choice") -> dict:
    if kind == "programming":
        return {"id": question_id, "type": kind, "question_set_title": "Python 编程", "stem_markdown": "读入 n 并输出 n + 1", "programming": {}}
    return {
        "id": question_id,
        "type": kind,
        "question_set_title": "Python 基础",
        "stem_markdown": "Python 的输入函数是？",
        "options": [
            {"id": 11, "label": "A", "content_markdown": "print", "correct": False},
            {"id": 12, "label": "B", "content_markdown": "input", "correct": True},
        ],
    }


def add_session(db, child_id: int, occurred_at: datetime, question_id: int, *, mode: str = "set", program_status: str | None = None) -> None:
    session = ExerciseSession(child_id=child_id, mode=mode, status="completed", title="Python 基础", score=0, max_score=4, created_at=occurred_at, completed_at=occurred_at)
    objective = ExerciseSessionItem(
        question_id=question_id, sort_order=0, points=2, snapshot_json=json.dumps(snapshot(question_id), ensure_ascii=False),
        answer=ExerciseAnswer(answer_json=json.dumps({"selected_option_ids": [11]}), status="WA", awarded_points=0, details_json="{}"),
    )
    session.items.append(objective)
    if program_status:
        program = ExerciseSessionItem(
            question_id=None, sort_order=1, points=2, snapshot_json=json.dumps(snapshot(999, "programming"), ensure_ascii=False),
            answer=ExerciseAnswer(
                answer_json="{}", status=program_status, awarded_points=0,
                details_json=json.dumps({"cases": [{"status": program_status}, {"status": program_status}, {"status": program_status}]}),
            ),
        )
        session.items.append(program)
    db.add(session)


def add_attempt(db, child_id: int, occurred_at: datetime, *, word: Word | None = None) -> None:
    text = word.spelling if word else "python"
    attempt = PracticeAttempt(
        child_id=child_id, word_set_id=word.word_set_id if word else None, word_id=word.id if word else None,
        prompt_snapshot=text, duration_ms=60_000, char_count=len(text) - 1, speed_char_count=len(text) - 1,
        metric_version=2, error_count=1, cpm=len(text) - 1, accuracy=80, created_at=occurred_at,
    )
    attempt.errors.append(AttemptError(expected_char="p", actual_char="o", count=1))
    db.add(attempt)


def seed_analysis_data(client: TestClient) -> tuple[int, int]:
    first = client.post("/api/admin/children", json={"name": "小宇", "pin": "1234", "active": True}).json()["id"]
    second = client.post("/api/admin/children", json={"name": "小林", "pin": "5678", "active": True}).json()["id"]
    now = datetime.utcnow()
    with client.app.state.session_factory() as db:
        word_set = WordSet(title="技术单词", description="")
        word = Word(word_set=word_set, spelling="python", normalized_spelling="python")
        question_set = QuestionSet(title="Python 基础", status="published")
        question = Question(question_set=question_set, type="single_choice", stem_markdown="Python 的输入函数是？", points=2, reviewed=True)
        db.add_all([word, question]); db.flush()

        for child_id in (first, first, second):
            add_attempt(db, child_id, now - timedelta(days=2))
            add_attempt(db, child_id, now - timedelta(days=2), word=word)
            add_session(db, child_id, now - timedelta(days=2), question.id, program_status="WA")
        # 上一同等周期，用于趋势对比。
        add_attempt(db, first, now - timedelta(days=40))
        add_attempt(db, first, now - timedelta(days=40), word=word)
        add_session(db, first, now - timedelta(days=40), question.id, program_status="WA")
        # 错题重练只进入反复未掌握榜，不抬高主榜作答数。
        add_session(db, first, now - timedelta(days=1), question.id, mode="wrong")
        db.add_all([
            WrongQuestion(child_id=first, question_id=question.id, wrong_count=3, mastered=False),
            WrongQuestion(child_id=second, question_id=question.id, wrong_count=1, mastered=False),
        ])
        db.commit()
    return first, second


def test_global_learning_analysis_aggregates_periods_and_modes(tmp_path):
    with make_client(tmp_path) as client:
        login(client)
        first, _ = seed_analysis_data(client)
        response = client.get("/api/admin/learning-analysis?days=30")
        assert response.status_code == 200
        result = response.json()
        assert result["summary"]["participating_students"] == 2
        assert result["summary"]["typing_attempts"] == 3
        assert result["typing"]["weak_keys"][0]["expected_char"] == "p"
        assert result["typing"]["confusion_pairs"][0]["actual_char"] == "o"
        assert result["typing"]["weak_keys"][0]["trend"]["previous"] is not None
        assert result["words"]["difficult_words"][0]["word"] == "python"

        difficult = result["exercises"]["difficult_questions"][0]
        assert difficult["attempt_count"] == 3
        assert difficult["affected_student_count"] == 2
        assert difficult["current_unmastered_count"] == 2
        assert difficult["common_wrong_answers"][0]["label"].startswith("误选 A")
        persistent = result["exercises"]["persistent_questions"][0]
        assert persistent["attempt_count"] == 1
        assert persistent["students"][0]["child_id"] == first

        programming = result["exercises"]["programming_failures"][0]
        assert programming["status"] == "WA"
        assert programming["attempt_count"] == 3  # 每次提交一次，不按 details.cases 累加。
        assert programming["affected_student_count"] == 2
        assert result["insights"]


def test_learning_analysis_permissions_empty_state_and_csv(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get("/api/admin/learning-analysis").status_code == 401
        login(client)
        seed_analysis_data(client)
        for section, marker in (("typing", "expected_char"), ("word", "wrong_rate"), ("exercise", "common_errors")):
            exported = client.get(f"/api/admin/learning-analysis/export.csv?days=30&section={section}")
            assert exported.status_code == 200
            assert marker in exported.content.decode("utf-8-sig").splitlines()[0]
        assert client.get("/api/admin/learning-analysis/export.csv?section=invalid").status_code == 422
        empty = client.get("/api/admin/learning-analysis?days=1").json()
        assert empty["summary"]["participating_students"] == 0
        assert empty["typing"]["weak_keys"] == []


def test_common_error_patterns_cover_objective_question_types():
    single = snapshot(1)
    assert _wrong_patterns(single, ExerciseAnswer(answer_json=json.dumps({"selected_option_ids": [11]}))) == ["误选 A：print"]

    multiple = {**snapshot(2), "type": "multiple_choice", "options": [
        {"id": 11, "label": "A", "content_markdown": "print", "correct": False},
        {"id": 12, "label": "B", "content_markdown": "input", "correct": True},
        {"id": 13, "label": "C", "content_markdown": "len", "correct": True},
    ]}
    assert _wrong_patterns(multiple, ExerciseAnswer(answer_json=json.dumps({"selected_option_ids": [11, 12]}))) == ["多选 A：print", "漏选 C：len"]

    judgment = {"type": "true_false", "correct_bool": True}
    assert _wrong_patterns(judgment, ExerciseAnswer(answer_json=json.dumps({"bool_answer": False}))) == ["选择错误"]

    fill = {"type": "fill_blank", "blanks": [{"position": 1}, {"position": 2}]}
    fill_answer = ExerciseAnswer(answer_json=json.dumps({"blank_answers": ["print"]}), details_json=json.dumps({"blank_correct": [False, False]}))
    assert _wrong_patterns(fill, fill_answer) == ["第 1 空：print", "第 2 空：未作答"]

    assert _wrong_patterns({"type": "programming"}, ExerciseAnswer(status="TLE")) == ["TLE"]
