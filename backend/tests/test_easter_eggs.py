from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func, select

from app import easter_eggs as policy
from app.models import ChildProfile, EasterEggReward, ExerciseAnswer, ExerciseSession, ExerciseSessionItem
from app.routers.exercises import _finish
from app.security import hash_secret
from test_exercises import make_client, admin_login, create_child, child_login


@pytest.fixture
def client(tmp_path):
    with make_client(tmp_path) as client:
        admin_login(client)
        create_child(client)
        yield client


def configure(client, **changes):
    admin_login(client)
    config = policy.RewardSettings(enabled=True, **changes).model_dump()
    result = client.put('/api/admin/easter-egg-settings', json=config)
    assert result.status_code == 200, result.text
    child_login(client)


def complete(client, score=80, maximum=100, count=10, mode='set', child_id=1, finish=True):
    with client.app.state.session_factory() as db:
        session = ExerciseSession(child_id=child_id, mode=mode, status='judging', max_score=maximum)
        session.items = [ExerciseSessionItem(sort_order=i, points=maximum if i == 0 else 0, snapshot_json='{}',
            answer=ExerciseAnswer(awarded_points=score if i == 0 else 0, status='correct')) for i in range(count)]
        db.add(session)
        db.commit()
        if finish:
            _finish(session, db)
        return session.id


def reward(client):
    response = client.get('/api/easter-eggs/reward')
    assert response.status_code == 200, response.text
    return response.json()['reward']


def start(client, rid, game='super-mario', instance='a' * 32, **extra):
    return client.post(f'/api/easter-eggs/rewards/{rid}/start', json={'game_id': game, 'instance_id': instance, **extra})


@pytest.mark.parametrize('score,maximum,count,mode,expected', [
    (79,100,10,'set',[]),(80,100,10,'set',['super-mario']), (90,100,10,'set',list(policy.GAMES)),
    (8,10,10,'random',['super-mario']), (7999,10000,10,'set',[]), (80,100,9,'set',[]),
    (100,100,10,'wrong',[]), (0,0,10,'set',[]),
])
def test_thresholds_and_eligibility(client, score, maximum, count, mode, expected):
    configure(client)
    complete(client, score, maximum, count, mode)
    result = reward(client)
    assert (result['games'] if result else []) == expected


def test_permissions_validation_and_disabled_history(client):
    assert client.get('/api/admin/easter-egg-settings').json()['enabled'] is False
    assert client.get('/api/admin/easter-egg-settings').json()['duration_minutes'] == 15
    child_login(client)
    sid = complete(client)
    assert reward(client) is None
    assert client.put('/api/admin/easter-egg-settings', json={'enabled': True}).status_code == 403
    configure(client)
    with client.app.state.session_factory() as db:
        _finish(db.get(ExerciseSession, sid), db)
    assert reward(client) is None  # Enabling never backfills historical completions.
    admin_login(client)
    for patch in ({'duration_minutes': 0}, {'duration_minutes': 61}, {'adventure_threshold': 101}, {'minimum_questions': 0}):
        assert client.put('/api/admin/easter-egg-settings', json=patch).status_code == 422


def test_upgrade_snapshot_and_once_after_start(client):
    configure(client)
    complete(client, 80)
    first = reward(client)
    configure(client, duration_minutes=30, racer_threshold=99)
    complete(client, 90)
    upgraded = reward(client)
    assert upgraded['id'] == first['id'] and upgraded['display_version'] == 2
    assert upgraded['games'] == list(policy.GAMES) and upgraded['duration_minutes'] == 15
    complete(client, 50)
    assert reward(client)['display_version'] == 2
    assert start(client, first['id']).status_code == 200
    complete(client, 100)
    assert reward(client)['id'] == first['id']


def test_random_is_persisted_and_not_rerolled(client, monkeypatch):
    choices = []
    monkeypatch.setattr(policy.secrets, 'choice', lambda games: choices.append(True) or 'kart-racer')
    configure(client, mode='random')
    complete(client, 80)
    assert reward(client)['games'] == ['kart-racer']
    complete(client, 100)
    assert reward(client)['games'] == ['kart-racer'] and len(choices) == 1


def test_judging_and_concurrent_completion(client):
    configure(client)
    sid = complete(client, 90, finish=False)
    assert reward(client) is None
    def finish():
        with client.app.state.session_factory() as db:
            _finish(db.get(ExerciseSession, sid), db)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: finish(), range(2)))
    assert reward(client)['games'] == list(policy.GAMES)
    with client.app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(EasterEggReward)) == 1


def test_parallel_different_practices_upgrade_one_daily_reward(client):
    configure(client)
    ids = [complete(client, score, finish=False) for score in (80, 90)]
    def finish(sid):
        with client.app.state.session_factory() as db:
            _finish(db.get(ExerciseSession, sid), db)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(finish, ids))
    assert reward(client)['games'] == list(policy.GAMES)
    with client.app.state.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(EasterEggReward)) == 1


def test_prepare_assets_start_retry_takeover_switch_leave_and_expiry(client, monkeypatch):
    now = datetime(2026, 9, 5, 10)
    monkeypatch.setattr(policy, 'utcnow', lambda: now)
    configure(client, duration_minutes=5)
    complete(client, 90)
    rid = reward(client)['id']
    payload = {'game_id': 'super-mario', 'instance_id': 'a' * 32}
    url = client.post(f'/api/easter-eggs/rewards/{rid}/prepare', json=payload).json()['url']
    page = client.get(url)
    assert page.status_code == 200 and 'window.rewardContext=' in page.text
    assert page.headers['cache-control'] == 'no-store'
    assert client.get(url.replace('index.html', '_shared/bridge.js')).status_code == 200
    assert client.get(url.replace('index.html', '%2e%2e%2f%2e%2e%2fapp%2fconfig.py')).status_code == 404
    assert reward(client)['play'] is None
    first = start(client, rid).json()['reward']['play']
    now += timedelta(seconds=20)
    assert start(client, rid).json()['reward']['play']['expires_at'] == first['expires_at']
    assert start(client, rid, instance='b' * 32).status_code == 409
    takeover = start(client, rid, instance='b' * 32, take_over=True)
    assert takeover.status_code == 200
    sid = first['id']
    assert client.post(f'/api/easter-eggs/sessions/{sid}/heartbeat', json={'instance_id': 'a' * 32}).status_code == 409
    changed = client.post(f'/api/easter-eggs/sessions/{sid}/switch', json={'game_id': 'kart-racer', 'instance_id': 'b' * 32})
    assert changed.json()['reward']['play']['expires_at'] == first['expires_at']
    client.post(f'/api/easter-eggs/sessions/{sid}/leave', json={'instance_id': 'b' * 32})
    assert start(client, rid, game='kart-racer', instance='c' * 32).status_code == 200
    now += timedelta(minutes=6)
    assert reward(client) is None
    assert start(client, rid).status_code == 410
    assert client.get(url).status_code == 410
    complete(client, 100)
    assert reward(client) is None


def test_disable_revokes_and_other_child_cannot_use_reward(client):
    configure(client)
    complete(client, 90)
    rid = reward(client)['id']
    sid = start(client, rid).json()['reward']['play']['id']
    with client.app.state.session_factory() as db:
        db.add(ChildProfile(name='小明', pin_hash=hash_secret('1234')))
        db.commit()
    client.post('/api/auth/child/login', json={'name': '小明', 'pin': '1234'})
    assert start(client, rid).status_code == 404
    assert reward(client) is None
    admin_login(client)
    client.put('/api/admin/easter-egg-settings', json={'enabled': False})
    child_login(client)
    assert client.post(f'/api/easter-eggs/sessions/{sid}/heartbeat', json={'instance_id': 'a' * 32}).status_code == 410
    configure(client)
    assert reward(client) is None


def test_beijing_midnight_pending_expiration_and_running_continuity(client, monkeypatch):
    now = datetime(2026, 9, 5, 15, 59)
    monkeypatch.setattr(policy, 'utcnow', lambda: now)
    configure(client, duration_minutes=5)
    complete(client)
    pending_id = reward(client)['id']
    now += timedelta(minutes=2)
    assert reward(client) is None
    assert start(client, pending_id).status_code == 410
    complete(client)
    second = reward(client)
    assert second['reward_date'] == '2026-09-06'
    now = datetime(2026, 9, 6, 15, 59)
    play = start(client, second['id']).json()['reward']['play']
    now += timedelta(minutes=2)
    complete(client)
    assert reward(client)['id'] == second['id']
    assert reward(client)['play']['expires_at'] == play['expires_at']
    now += timedelta(minutes=4)
    assert reward(client)['reward_date'] == '2026-09-07'
