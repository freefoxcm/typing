import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import func, select

from app.models import AttemptError, PracticeAttempt, Prompt, Word, WordSet
from app.routers import practice
from test_api import admin_login, make_client


@pytest.fixture(params=['course', 'word'])
def retry_case(tmp_path, request):
    with make_client(tmp_path) as client:
        admin_login(client)
        client.post('/api/admin/children', json={'name': '重试学生', 'pin': '1234', 'active': True})
        with client.app.state.session_factory() as db:
            if request.param == 'course':
                prompt = db.scalar(select(Prompt))
                path = '/api/practice/attempts'
                target = {'prompt_id': prompt.id}
            else:
                word_set = WordSet(title='重试词库', active=True)
                db.add(word_set); db.flush()
                word = Word(word_set_id=word_set.id, spelling='abc', normalized_spelling='abc', active=True, enrichment_status='ready')
                db.add(word); db.commit()
                path = '/api/practice/word-attempts'
                target = {'word_id': word.id}
        client.post('/api/auth/logout')
        client.post('/api/auth/child/login', json={'name': '重试学生', 'pin': '1234'})
        yield client, path, {**target, 'request_id': 'retry-request-0001', 'duration_ms': 1000, 'errors': [{'expected_char': 'a', 'actual_char': 'b', 'count': 1}]}


def test_retry_returns_original_result_and_rejects_changed_payload(retry_case):
    client, path, payload = retry_case
    first = client.post(path, json=payload)
    assert first.status_code == 200
    assert client.post(path, json=payload).json() == first.json()
    assert client.post(path, json={**payload, 'duration_ms': 2000}).status_code == 409
    with client.app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(PracticeAttempt)) == 1
        assert db.scalar(select(func.count()).select_from(AttemptError)) == 1
    # A new run is a new record; older clients without a key keep their existing behavior.
    assert client.post(path, json={**payload, 'request_id': 'retry-request-0002'}).json()['id'] != first.json()['id']
    legacy = {key: value for key, value in payload.items() if key != 'request_id'}
    assert client.post(path, json=legacy).json()['id'] != client.post(path, json=legacy).json()['id']


def test_simultaneous_retries_commit_one_attempt(retry_case, monkeypatch):
    client, path, payload = retry_case
    barrier = threading.Barrier(2)
    original = practice._commit_attempt
    def commit(db, attempt, body):
        barrier.wait(timeout=5)
        return original(db, attempt, body)
    monkeypatch.setattr(practice, '_commit_attempt', commit)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: client.post(path, json=payload), range(2)))
    assert [response.status_code for response in responses] == [200, 200]
    assert responses[0].json() == responses[1].json()
    with client.app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(PracticeAttempt)) == 1
        assert db.scalar(select(func.count()).select_from(AttemptError)) == 1


def test_retry_key_is_scoped_to_student_and_requires_login(retry_case):
    client, path, payload = retry_case
    first = client.post(path, json=payload).json()
    client.post('/api/auth/logout')
    assert client.post(path, json=payload).status_code == 401
    admin_login(client)
    client.post('/api/admin/children', json={'name': '另一学生', 'pin': '5678', 'active': True})
    client.post('/api/auth/logout')
    client.post('/api/auth/child/login', json={'name': '另一学生', 'pin': '5678'})
    other = client.post(path, json=payload)
    assert other.status_code == 200 and other.json()['id'] != first['id']
