import base64
import io
import json
import zipfile
from pathlib import Path

import pymupdf as fitz
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.config import Settings
from app.main import create_app
from app.models import Question, QuestionSet
from app.question_bundles import set_fingerprint


PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=")


def make_client(root: Path) -> TestClient:
    root.mkdir(parents=True, exist_ok=True)
    return TestClient(create_app(Settings(
        database_url=f"sqlite:///{root / 'test.db'}",
        admin_username="root",
        admin_password="correct-horse",
        session_secret="test-secret-with-enough-entropy",
        frontend_dist=str(root / "dist"),
        question_asset_dir=str(root / "assets"),
        judge_queue_dir=str(root / "judge"),
        seed_demo_data=False,
    )))


def login(client: TestClient) -> None:
    assert client.post("/api/auth/admin/login", json={"username": "root", "password": "correct-horse"}).status_code == 200


def question_payload(kind: str, order: int) -> dict:
    base = {
        "type": kind,
        "stem_markdown": f"{kind} 题面" if kind != "fill_blank" else "输出函数是 {{1}}。",
        "explanation_markdown": f"{kind} 解析",
        "points": order + 1,
        "sort_order": order,
        "reviewed": False,
        "correct_bool": None,
        "show_source_crop": kind == "single_choice",
        "options": [],
        "blanks": [],
        "programming": None,
    }
    if kind in {"single_choice", "multiple_choice"}:
        base["options"] = [
            {"label": "A", "content_markdown": "选项 A", "correct": True, "sort_order": 0},
            {"label": "B", "content_markdown": "选项 B", "correct": kind == "multiple_choice", "sort_order": 1},
        ]
    elif kind == "true_false":
        base["correct_bool"] = True
    elif kind == "fill_blank":
        base["blanks"] = [{"position": 1, "accepted_answers": ["print", "PRINT"]}]
    elif kind == "programming":
        base["programming"] = {
            "input_markdown": "输入一个整数。",
            "output_markdown": "输出该整数。",
            "constraints_markdown": "0 <= n <= 10",
            "starter_code": "n = int(input())",
            "reference_solution": "print(int(input()))",
            "time_limit_ms": 1000,
            "memory_limit_mb": 128,
            "cases": [
                {"input_data": "1\n", "expected_output": "1\n", "is_sample": True, "weight": 0, "confirmed": True, "note": "样例", "explanation_markdown": "因为输入和输出相同。"},
                {"input_data": "10\n", "expected_output": "10\n", "is_sample": False, "weight": order + 1, "confirmed": True, "note": "边界"},
            ],
        }
    return base


def build_source_bundle(client: TestClient) -> tuple[int, bytes]:
    question_set = client.post("/api/admin/question-sets", json={"title": "迁移测试", "description": "五种题型"}).json()
    question_ids = []
    for order, kind in enumerate(("single_choice", "multiple_choice", "true_false", "fill_blank", "programming")):
        response = client.post(f"/api/admin/question-sets/{question_set['id']}/questions", json=question_payload(kind, order))
        assert response.status_code == 201, response.text
        question_ids.append(response.json()["id"])

    assert client.put(
        f"/api/admin/questions/{question_ids[0]}/source-image",
        files={"file": ("source.png", PNG, "image/png")},
    ).status_code == 200
    assert client.put(
        f"/api/admin/questions/{question_ids[0]}/stem-image",
        files={"file": ("stem.png", PNG, "image/png")},
    ).status_code == 200
    document = fitz.open()
    document.new_page()
    pdf = document.tobytes()
    document.close()
    assert client.put(
        f"/api/admin/question-sets/{question_set['id']}/source-pdf",
        files={"file": ("paper.pdf", pdf, "application/pdf")},
    ).status_code == 200
    for question_id in question_ids:
        assert client.patch(f"/api/admin/questions/{question_id}/review", json={"reviewed": True}).status_code == 200

    response = client.post("/api/admin/question-set-bundles/export", json={"question_set_ids": [question_set["id"]]})
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        assert manifest["version"] == 2
        assert len(manifest["assets"]) == 3
    return question_set["id"], response.content


def test_bundle_export_includes_every_selected_set(tmp_path):
    with make_client(tmp_path / "multi") as client:
        login(client)
        first = client.post("/api/admin/question-sets", json={"title": "批量迁移甲", "description": "第一套"}).json()
        second = client.post("/api/admin/question-sets", json={"title": "批量迁移乙", "description": "第二套"}).json()

        response = client.post(
            "/api/admin/question-set-bundles/export",
            json={"question_set_ids": [first["id"], second["id"]]},
        )
        assert response.status_code == 200, response.text
        assert "question-sets-2sets-" in response.headers["content-disposition"]
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
        assert [item["title"] for item in manifest["question_sets"]] == ["批量迁移甲", "批量迁移乙"]

        preview = client.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("multi.zip", response.content, "application/zip")},
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["question_set_count"] == 2


def test_bundle_round_trip_copy_and_overwrite_preserve_content_and_ids(tmp_path):
    with make_client(tmp_path / "source") as source:
        login(source)
        _, bundle = build_source_bundle(source)

    with make_client(tmp_path / "target") as target:
        login(target)
        preview = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("questions.zip", bundle, "application/zip")},
        ).json()
        assert preview["valid"] is True, preview
        item = preview["question_sets"][0]
        assert item["default_action"] == "create"
        assert item["question_count"] == 5 and item["asset_count"] == 3 and item["programming_case_count"] == 2

        decisions = [{"migration_key": item["migration_key"], "action": "create"}]
        imported = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("questions.zip", bundle, "application/zip")},
            data={"decisions": json.dumps(decisions)},
        )
        assert imported.status_code == 200, imported.text
        set_id = imported.json()["created"][0]["id"]
        stored = target.get(f"/api/admin/question-sets/{set_id}").json()
        assert stored["status"] == "draft"
        assert all(question["reviewed"] for question in stored["questions"])
        assert stored["source_pdf_asset_id"]
        assert stored["questions"][0]["source_asset_id"] and stored["questions"][0]["stem_image_asset_id"]
        assert len(stored["questions"][-1]["programming"]["cases"]) == 2
        assert stored["questions"][-1]["programming"]["cases"][0]["explanation_markdown"] == "因为输入和输出相同。"
        original_question_id = stored["questions"][0]["id"]

        unchanged = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("questions.zip", bundle, "application/zip")},
        ).json()["question_sets"][0]
        assert unchanged["conflict"] == "same_origin_unchanged" and unchanged["default_action"] == "skip"

        copied = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("questions.zip", bundle, "application/zip")},
            data={"decisions": json.dumps([{
                "migration_key": item["migration_key"],
                "action": "copy",
                "target_set_id": unchanged["target"]["id"],
                "expected_target_fingerprint": unchanged["target"]["fingerprint"],
            }])},
        )
        assert copied.status_code == 200 and copied.json()["copied"]

        old_asset_files = set((tmp_path / "target" / "assets").iterdir())
        changed_question = stored["questions"][0]
        changed_question["stem_markdown"] = "目标服务器临时修改"
        assert target.put(f"/api/admin/questions/{original_question_id}", json=changed_question).status_code == 200
        extra = target.post(f"/api/admin/question-sets/{set_id}/questions", json=question_payload("true_false", 99)).json()
        changed = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("questions.zip", bundle, "application/zip")},
        ).json()["question_sets"][0]
        assert changed["conflict"] == "same_origin_changed" and "overwrite" in changed["allowed_actions"]
        overwrite = [{
            "migration_key": item["migration_key"],
            "action": "overwrite",
            "target_set_id": set_id,
            "expected_target_fingerprint": changed["target"]["fingerprint"],
        }]
        response = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("questions.zip", bundle, "application/zip")},
            data={"decisions": json.dumps(overwrite)},
        )
        assert response.status_code == 200, response.text
        overwritten = target.get(f"/api/admin/question-sets/{set_id}").json()
        assert len(overwritten["questions"]) == 5
        assert overwritten["questions"][0]["id"] == original_question_id
        assert overwritten["questions"][0]["stem_markdown"] == "single_choice 题面"
        assert old_asset_files < set((tmp_path / "target" / "assets").iterdir())
        with target.app.state.session_factory() as db:
            assert db.get(Question, extra["id"]) is None
            sets = db.scalars(select(QuestionSet)).all()
            assert len(sets) == 2


def test_bundle_version_one_remains_importable(tmp_path):
    with make_client(tmp_path / "legacy-source") as source:
        login(source)
        _, current_bundle = build_source_bundle(source)

    source_archive = zipfile.ZipFile(io.BytesIO(current_bundle))
    manifest = json.loads(source_archive.read("manifest.json"))
    manifest["version"] = 1
    asset_sha = {key: value["sha256"] for key, value in manifest["assets"].items()}
    for question_set in manifest["question_sets"]:
        for question in question_set["questions"]:
            if question.get("programming"):
                for case in question["programming"].get("cases", []):
                    case.pop("explanation_markdown", None)
        question_set["fingerprint"] = set_fingerprint(question_set, asset_sha, 1)
    legacy_bytes = io.BytesIO()
    with zipfile.ZipFile(legacy_bytes, "w", compression=zipfile.ZIP_DEFLATED) as legacy_archive:
        legacy_archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        for name in source_archive.namelist():
            if name != "manifest.json":
                legacy_archive.writestr(name, source_archive.read(name))
    source_archive.close()

    with make_client(tmp_path / "legacy-target") as target:
        login(target)
        preview = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("legacy.zip", legacy_bytes.getvalue(), "application/zip")},
        )
        assert preview.status_code == 200, preview.text
        item = preview.json()["question_sets"][0]
        imported = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("legacy.zip", legacy_bytes.getvalue(), "application/zip")},
            data={"decisions": json.dumps([{"migration_key": item["migration_key"], "action": "create"}])},
        )
        assert imported.status_code == 200, imported.text
        stored = target.get(f"/api/admin/question-sets/{imported.json()['created'][0]['id']}").json()
        assert stored["questions"][-1]["programming"]["cases"][0]["explanation_markdown"] == ""


def test_bundle_detects_stale_preview_for_copy_and_supports_empty_sets(tmp_path):
    with make_client(tmp_path / "source") as source:
        login(source)
        _, bundle = build_source_bundle(source)
        empty = source.post("/api/admin/question-sets", json={"title": "空题套", "description": "稍后录题"}).json()
        empty_bundle = source.post("/api/admin/question-set-bundles/export", json={"question_set_ids": [empty["id"]]})
        assert empty_bundle.status_code == 200, empty_bundle.text

    with make_client(tmp_path / "target") as target:
        login(target)
        first = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("questions.zip", bundle, "application/zip")},
        ).json()["question_sets"][0]
        created = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("questions.zip", bundle, "application/zip")},
            data={"decisions": json.dumps([{"migration_key": first["migration_key"], "action": "create"}])},
        ).json()
        target_set_id = created["created"][0]["id"]
        preview = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("questions.zip", bundle, "application/zip")},
        ).json()["question_sets"][0]
        assert target.put(
            f"/api/admin/question-sets/{target_set_id}",
            json={"title": "预览后修改", "description": "触发 stale"},
        ).status_code == 200
        stale = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("questions.zip", bundle, "application/zip")},
            data={"decisions": json.dumps([{
                "migration_key": preview["migration_key"],
                "action": "copy",
                "target_set_id": preview["target"]["id"],
                "expected_target_fingerprint": preview["target"]["fingerprint"],
            }])},
        )
        assert stale.status_code == 409 and "重新预览" in stale.text

        empty_preview = target.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("empty.zip", empty_bundle.content, "application/zip")},
        ).json()
        assert empty_preview["valid"] is True and empty_preview["question_count"] == 0
        imported = target.post(
            "/api/admin/question-set-bundles/import",
            files={"file": ("empty.zip", empty_bundle.content, "application/zip")},
            data={"decisions": json.dumps([{"migration_key": empty_preview["question_sets"][0]["migration_key"], "action": "create"}])},
        )
        assert imported.status_code == 200


def test_bundle_rejects_unsafe_archive_and_source_pdf_requires_draft(tmp_path):
    with make_client(tmp_path) as client:
        login(client)
        unsafe = io.BytesIO()
        with zipfile.ZipFile(unsafe, "w") as archive:
            archive.writestr("../manifest.json", "{}")
        preview = client.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("unsafe.zip", unsafe.getvalue(), "application/zip")},
        ).json()
        assert preview["valid"] is False and "路径" in preview["errors"][0]

        set_id, bundle = build_source_bundle(client)
        tampered = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(bundle)) as source, zipfile.ZipFile(tampered, "w") as target:
            manifest = json.loads(source.read("manifest.json"))
            first_asset = next(iter(manifest["assets"].values()))
            first_asset["sha256"] = "0" * 64
            target.writestr("manifest.json", json.dumps(manifest))
            for name in source.namelist():
                if name != "manifest.json":
                    target.writestr(name, source.read(name))
        invalid_hash = client.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("tampered.zip", tampered.getvalue(), "application/zip")},
        ).json()
        assert invalid_hash["valid"] is False and "校验失败" in invalid_hash["errors"][0]

        old_assets = set((tmp_path / "assets").iterdir())
        replacement = fitz.open(); replacement.new_page(); replacement.new_page(); replacement_pdf = replacement.tobytes(); replacement.close()
        replaced = client.put(
            f"/api/admin/question-sets/{set_id}/source-pdf",
            files={"file": ("replacement.pdf", replacement_pdf, "application/pdf")},
        )
        assert replaced.status_code == 200
        assert all(not question["reviewed"] for question in replaced.json()["questions"])
        assert old_assets < set((tmp_path / "assets").iterdir())
        for question in replaced.json()["questions"]:
            assert client.patch(f"/api/admin/questions/{question['id']}/review", json={"reviewed": True}).status_code == 200

        assert client.post(f"/api/admin/question-sets/{set_id}/publish").status_code == 200
        document = fitz.open(); document.new_page(); pdf = document.tobytes(); document.close()
        blocked = client.put(
            f"/api/admin/question-sets/{set_id}/source-pdf",
            files={"file": ("new.pdf", pdf, "application/pdf")},
        )
        assert blocked.status_code == 409

        preview = client.post(
            "/api/admin/question-set-bundles/preview",
            files={"file": ("same.zip", bundle, "application/zip")},
        ).json()["question_sets"][0]
        assert "overwrite" not in preview["allowed_actions"]
