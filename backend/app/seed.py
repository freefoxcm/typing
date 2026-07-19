from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .models import Admin, Course, Lesson, Prompt
from .security import hash_secret, verify_secret


def bootstrap(db: Session, settings: Settings) -> None:
    admin = db.scalar(select(Admin).where(Admin.username == settings.admin_username))
    if not admin:
        db.add(Admin(username=settings.admin_username, password_hash=hash_secret(settings.admin_password)))

    course_count = db.scalar(select(func.count()).select_from(Course)) or 0
    if settings.seed_demo_data and course_count == 0:
        course = Course(title="键盘启蒙", description="从基准键开始，逐步熟悉英文键盘。", sort_order=0)
        home = Lesson(course=course, title="F 和 J", description="找到带凸点的两个基准键。", sort_order=0)
        home.prompts = [
            Prompt(content="fff jjj fjf jfj", sort_order=0),
            Prompt(content="ff jj fj jf", sort_order=1),
            Prompt(content="find joy", sort_order=2),
        ]
        code = Lesson(course=course, title="Python 入门", description="练习常见的 Python 代码片段。", sort_order=1)
        code.prompts = [
            Prompt(content='print("Hello, world!")', sort_order=0),
            Prompt(content="for i in range(5):\n\tprint(i)", sort_order=1),
            Prompt(content="name = input(\"Your name: \" )", sort_order=2),
        ]
        db.add(course)
    db.commit()
