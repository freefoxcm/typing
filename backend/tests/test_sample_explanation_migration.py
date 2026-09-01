import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config


def test_migration_moves_existing_sample_explanations_without_touching_notes(tmp_path, monkeypatch):
    database = tmp_path / "migration.db"
    database_url = f"sqlite:///{database.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "0010_exercise_session_position")

    connection = sqlite3.connect(database)
    connection.execute(
        "INSERT INTO question_sets "
        "(id,title,description,status,source_pdf_asset_id,created_at,updated_at,published_at,sort_order,migration_key) "
        "VALUES (1,'迁移题套','','draft',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,NULL,0,?)",
        ("a" * 32,),
    )
    connection.execute(
        "INSERT INTO questions "
        "(id,question_set_id,type,stem_markdown,explanation_markdown,points,sort_order,reviewed,correct_bool,"
        "source_page,source_asset_id,show_source_crop,created_at,updated_at,source_end_page,recognition_confidence,"
        "recognition_warnings_json,source_section,source_number,stem_image_asset_id,migration_key) "
        "VALUES (1,1,'programming',?,'',10,0,0,NULL,1,NULL,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,1,NULL,'[]','','',NULL,?)",
        ("题面\n\n### 样例解释 1\n第一条说明\n\n### 样例说明 2\n第二条说明", "b" * 32),
    )
    connection.execute(
        "INSERT INTO programming_specs VALUES (1,'','','','','',1000,128)"
    )
    connection.execute(
        "INSERT INTO programming_cases (id,question_id,input_data,expected_output,is_sample,weight,confirmed,note) "
        "VALUES (1,1,'1','1',1,0,0,'输入样例 1'), (2,1,'2','2',1,0,0,'输入样例 2')"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, "head")
    connection = sqlite3.connect(database)
    stem = connection.execute("SELECT stem_markdown FROM questions WHERE id = 1").fetchone()[0]
    cases = connection.execute(
        "SELECT note, explanation_markdown FROM programming_cases WHERE question_id = 1 ORDER BY id"
    ).fetchall()
    connection.close()

    assert stem == "题面"
    assert cases == [("输入样例 1", "第一条说明"), ("输入样例 2", "第二条说明")]
