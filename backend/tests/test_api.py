from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(tmp_path: Path) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        admin_username='root',
        admin_password='correct-horse',
        session_secret='test-secret-with-enough-entropy',
        frontend_dist=str(tmp_path / 'dist'),
        seed_demo_data=True,
    )
    return TestClient(create_app(settings))


def admin_login(client: TestClient):
    response = client.post('/api/auth/admin/login', json={'username': 'root', 'password': 'correct-horse'})
    assert response.status_code == 200


def test_health_and_role_protection(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get('/api/health').json() == {'status': 'ok'}
        assert client.get('/api/admin/children').status_code == 401
        admin_login(client)
        assert client.get('/api/admin/children').status_code == 200
        assert client.get('/api/library/courses').status_code == 403


def test_child_practice_and_report_flow(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        created = client.post('/api/admin/children', json={'name': '小宇', 'pin': '1234', 'active': True})
        assert created.status_code == 201
        child_id = created.json()['id']
        client.post('/api/auth/logout')
        logged_in = client.post('/api/auth/child/login', json={'child_id': child_id, 'pin': '1234'})
        assert logged_in.status_code == 200
        courses = client.get('/api/library/courses').json()
        lesson_id = courses[0]['lessons'][0]['id']
        prompt = client.get(f'/api/library/lessons/{lesson_id}').json()['prompts'][0]
        saved = client.post('/api/practice/attempts', json={
            'prompt_id': prompt['id'],
            'duration_ms': 10_000,
            'errors': [{'expected_char': 'f', 'actual_char': 'd', 'count': 2}],
        })
        assert saved.status_code == 200
        assert saved.json()['accuracy'] < 100
        client.post('/api/auth/logout')
        admin_login(client)
        report = client.get(f'/api/admin/reports/summary?child_id={child_id}&days=30').json()
        assert report['attempt_count'] == 1
        assert report['weak_keys'][0] == {'char': 'f', 'count': 2}


def test_import_is_transactional_and_visible(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        invalid = client.post('/api/admin/import', json={'format': 'csv', 'content': 'course,lesson,prompt\nNew,L1,你好', 'mode': 'append'})
        assert invalid.status_code == 422
        valid = client.post('/api/admin/import', json={'format': 'csv', 'content': 'course,lesson,prompt\nNew,L1,hello world', 'mode': 'append'})
        assert valid.status_code == 200
        library = client.get('/api/admin/library').json()
        assert any(course['title'] == 'New' for course in library)

