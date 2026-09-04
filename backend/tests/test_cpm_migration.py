import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config


def test_cpm_migration_versions_and_backfills_existing_attempts(tmp_path, monkeypatch):
    database = tmp_path / "cpm-migration.db"
    database_url = f"sqlite:///{database.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(config, "0011_programming_sample_explanations")

    connection = sqlite3.connect(database)
    connection.execute(
        "INSERT INTO child_profiles (id,name,pin_hash,active,created_at) "
        "VALUES (1,'历史学生','hash',1,CURRENT_TIMESTAMP)"
    )
    connection.execute(
        "INSERT INTO practice_attempts "
        "(id,child_id,prompt_snapshot,duration_ms,char_count,error_count,cpm,accuracy,created_at) "
        "VALUES (1,1,'abcde',800,5,0,375,100,CURRENT_TIMESTAMP)"
    )
    connection.commit()
    connection.close()

    command.upgrade(config, "head")
    connection = sqlite3.connect(database)
    migrated = connection.execute(
        "SELECT speed_char_count, metric_version, cpm FROM practice_attempts WHERE id = 1"
    ).fetchone()
    columns = {row[1]: row[3] for row in connection.execute("PRAGMA table_info(practice_attempts)")}
    connection.close()

    assert migrated == (5, 1, 375)
    assert columns["speed_char_count"] == 1
    assert columns["metric_version"] == 1
    assert columns["cpm"] == 0
    assert columns["request_id"] == 0
    assert columns["request_fingerprint"] == 0
