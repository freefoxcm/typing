import sqlite3
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config


def test_request_id_migration_preserves_attempts_and_errors_and_enforces_uniqueness(tmp_path, monkeypatch):
    database = tmp_path / 'retry-migration.db'
    url = f'sqlite:///{database.as_posix()}'
    monkeypatch.setenv('DATABASE_URL', url)
    root = Path(__file__).resolve().parents[1]
    config = Config(str(root / 'alembic.ini'))
    config.set_main_option('script_location', str(root / 'alembic'))
    config.set_main_option('sqlalchemy.url', url)
    command.upgrade(config, '0012_cpm_metric_version')
    with sqlite3.connect(database) as connection:
        connection.execute("INSERT INTO child_profiles (id,name,pin_hash,active,created_at) VALUES (1,'历史学生','hash',1,CURRENT_TIMESTAMP)")
        for attempt_id in [1, 2]:
            connection.execute("INSERT INTO practice_attempts (id,child_id,prompt_snapshot,duration_ms,char_count,speed_char_count,metric_version,error_count,cpm,accuracy,created_at) VALUES (?,1,'abc',1000,3,2,2,1,120,75,CURRENT_TIMESTAMP)", (attempt_id,))
        connection.execute("INSERT INTO attempt_errors (id,attempt_id,expected_char,actual_char,count) VALUES (1,1,'a','b',1)")
    command.upgrade(config, 'head')
    with sqlite3.connect(database) as connection:
        assert connection.execute('SELECT id,prompt_snapshot,request_id FROM practice_attempts ORDER BY id').fetchall() == [(1, 'abc', None), (2, 'abc', None)]
        assert connection.execute('SELECT attempt_id,count FROM attempt_errors').fetchall() == [(1, 1)]
        connection.execute("UPDATE practice_attempts SET request_id='unique-request-key' WHERE id=1")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE practice_attempts SET request_id='unique-request-key' WHERE id=2")
