import json
import sys
import tempfile
from pathlib import Path
root = Path(__file__).resolve().parents[2]
fixture_dir = Path(tempfile.mkdtemp(prefix="typing-reward-qa-"))
sys.path.insert(0, str(root / 'backend'))
from app.config import Settings
from app.main import create_app
from app.models import ChildProfile, EasterEggSettings, ExerciseSession, ExerciseSessionItem, ExerciseAnswer
from app.easter_eggs import RewardSettings
from app.routers.exercises import _finish
from app.security import hash_secret
from app.database import Base
from app.seed import bootstrap
from sqlalchemy import select

settings = Settings(database_url=f"sqlite:///{fixture_dir / 'reward-qa.db'}", admin_username='reward-qa', admin_password='reward-qa-local', session_secret='reward-qa-local-session-secret',
    frontend_dist=str(root / 'frontend/dist'), question_asset_dir=str(fixture_dir / 'assets'), judge_queue_dir=str(fixture_dir / 'judge'), pyright_enabled=False, seed_demo_data=False)
app = create_app(settings)
Base.metadata.create_all(app.state.engine)
with app.state.session_factory() as db:
    bootstrap(db, settings)
    if not db.scalar(select(ChildProfile)):
        db.add(EasterEggSettings(id=1, config_json=RewardSettings(enabled=True, duration_minutes=1).model_dump_json()))
        for index, score in enumerate([90, 80, 90, 90]):
            child = ChildProfile(name=f'彩蛋体验{index+1}', pin_hash=hash_secret('1234'))
            db.add(child); db.flush()
            session = ExerciseSession(child_id=child.id, mode='set', status='judging', title='彩蛋体验练习', max_score=100)
            session.items = [ExerciseSessionItem(sort_order=i, points=10, snapshot_json=json.dumps({'id':i+1,'type':'true_false','stem_markdown':f'第 {i+1} 题：认真练习可以积累知识。','explanation_markdown':'每一次练习都是新的进步。','options':[],'correct_bool':True}),
                answer=ExerciseAnswer(awarded_points=10 if i < score/10 else 0, answer_json='{"bool_answer": true}', status='correct', details_json='{"correct": true}')) for i in range(10)]
            db.add(session); db.commit(); _finish(session, db)

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='127.0.0.1', port=8093, log_level='warning')
