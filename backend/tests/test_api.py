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
        logged_in = client.post('/api/auth/child/login', json={'name': '小宇', 'pin': '1234'})
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
        overview = client.get('/api/admin/reports/overview?days=30').json()['students']
        student = next(item for item in overview if item['child_id'] == child_id)
        assert student['course_attempt_count'] == 1
        assert student['word_attempt_count'] == 0
        assert student['exercise_total'] == 0
        exported = client.get('/api/admin/reports/export.csv?view=overview&days=30')
        assert exported.status_code == 200
        assert 'course_attempts' in exported.content.decode('utf-8-sig')


def test_child_login_uses_name_without_exposing_roster(tmp_path):
    with make_client(tmp_path) as client:
        assert client.get('/api/auth/children').status_code == 404
        admin_login(client)
        created = client.post('/api/admin/children', json={'name': '小宇', 'pin': '1234', 'active': True})
        assert created.status_code == 201
        child_id = created.json()['id']
        client.post('/api/auth/logout')

        logged_in = client.post('/api/auth/child/login', json={'name': '  小宇  ', 'pin': '1234'})
        assert logged_in.status_code == 200
        assert logged_in.json()['name'] == '小宇'
        client.post('/api/auth/logout')

        wrong_pin = client.post('/api/auth/child/login', json={'name': '小宇', 'pin': '5678'})
        missing = client.post('/api/auth/child/login', json={'name': '小明', 'pin': '5678'})
        assert wrong_pin.status_code == missing.status_code == 401
        assert wrong_pin.json() == missing.json() == {'detail': '姓名或 PIN 不正确'}

        admin_login(client)
        assert client.patch(f'/api/admin/children/{child_id}', json={'active': False}).status_code == 200
        client.post('/api/auth/logout')
        inactive = client.post('/api/auth/child/login', json={'name': '小宇', 'pin': '1234'})
        assert inactive.status_code == 401
        assert inactive.json() == {'detail': '姓名或 PIN 不正确'}


def test_import_is_transactional_and_visible(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        invalid = client.post('/api/admin/import', json={'format': 'csv', 'content': 'course,lesson,prompt\nNew,L1,你好', 'mode': 'append'})
        assert invalid.status_code == 422
        valid = client.post('/api/admin/import', json={'format': 'csv', 'content': 'course,lesson,prompt\nNew,L1,hello world', 'mode': 'append'})
        assert valid.status_code == 200
        library = client.get('/api/admin/library').json()
        assert any(course['title'] == 'New' for course in library)


def test_course_order_is_atomic_and_visible_everywhere(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        child = client.post('/api/admin/children', json={'name': '小宇', 'pin': '1234', 'active': True})
        assert child.status_code == 201
        for sort_order, title in enumerate(['第二课程', '第三课程'], start=1):
            created = client.post('/api/admin/courses', json={
                'title': title,
                'description': '',
                'sort_order': sort_order,
                'active': True,
            })
            assert created.status_code == 201
            lesson = client.post('/api/admin/lessons', json={
                'course_id': created.json()['id'],
                'title': f'{title}关卡',
                'description': '',
                'sort_order': 0,
                'active': True,
            })
            assert lesson.status_code == 201
            prompt = client.post('/api/admin/prompts', json={
                'lesson_id': lesson.json()['id'],
                'content': f'practice {sort_order}',
                'sort_order': 0,
                'active': True,
            })
            assert prompt.status_code == 201

        original = client.get('/api/admin/library').json()
        reversed_ids = [course['id'] for course in reversed(original)]
        reordered = client.put('/api/admin/courses/order', json={'course_ids': reversed_ids})
        assert reordered.status_code == 200
        assert reordered.json() == {'ok': True, 'course_ids': reversed_ids}
        assert [course['id'] for course in client.get('/api/admin/library').json()] == reversed_ids

        arbitrary_ids = [reversed_ids[1], reversed_ids[2], reversed_ids[0]]
        reordered = client.put('/api/admin/courses/order', json={'course_ids': arbitrary_ids})
        assert reordered.status_code == 200
        assert [course['id'] for course in client.get('/api/admin/library').json()] == arbitrary_ids
        assert [course['id'] for course in client.get('/api/admin/export').json()['courses']] == arbitrary_ids

        client.post('/api/auth/logout')
        assert client.post('/api/auth/child/login', json={'name': '小宇', 'pin': '1234'}).status_code == 200
        assert [course['id'] for course in client.get('/api/library/courses').json()] == arbitrary_ids


def test_course_order_rejects_stale_or_invalid_lists_without_changes(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        created = client.post('/api/admin/courses', json={
            'title': '第二课程',
            'description': '',
            'sort_order': 1,
            'active': False,
        })
        assert created.status_code == 201
        original_ids = [course['id'] for course in client.get('/api/admin/library').json()]

        duplicate = client.put('/api/admin/courses/order', json={'course_ids': [original_ids[0], original_ids[0]]})
        missing = client.put('/api/admin/courses/order', json={'course_ids': original_ids[:-1]})
        unknown = client.put('/api/admin/courses/order', json={'course_ids': [*original_ids[:-1], 999999]})
        assert duplicate.status_code == 422
        assert missing.status_code == 409
        assert unknown.status_code == 409
        assert [course['id'] for course in client.get('/api/admin/library').json()] == original_ids
