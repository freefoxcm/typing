"""Initial application schema."""
from alembic import op
import sqlalchemy as sa

revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table("admins", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("username", sa.String(80), nullable=False), sa.Column("password_hash", sa.String(255), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False), sa.UniqueConstraint("username"))
    op.create_index("ix_admins_username", "admins", ["username"], unique=True)
    op.create_table("child_profiles", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("name", sa.String(80), nullable=False), sa.Column("pin_hash", sa.String(255), nullable=False), sa.Column("active", sa.Boolean(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False), sa.UniqueConstraint("name"))
    op.create_index("ix_child_profiles_name", "child_profiles", ["name"], unique=True)
    op.create_index("ix_child_profiles_active", "child_profiles", ["active"])
    op.create_table("auth_sessions", sa.Column("token_hash", sa.String(64), primary_key=True), sa.Column("role", sa.String(16), nullable=False), sa.Column("actor_id", sa.Integer(), nullable=False), sa.Column("expires_at", sa.DateTime(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_auth_sessions_role", "auth_sessions", ["role"])
    op.create_index("ix_auth_sessions_actor_id", "auth_sessions", ["actor_id"])
    op.create_index("ix_auth_sessions_expires_at", "auth_sessions", ["expires_at"])
    op.create_table("courses", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("title", sa.String(120), nullable=False), sa.Column("description", sa.Text(), nullable=False), sa.Column("sort_order", sa.Integer(), nullable=False), sa.Column("active", sa.Boolean(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False), sa.UniqueConstraint("title"))
    op.create_index("ix_courses_active", "courses", ["active"])
    op.create_table("lessons", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False), sa.Column("title", sa.String(120), nullable=False), sa.Column("description", sa.Text(), nullable=False), sa.Column("sort_order", sa.Integer(), nullable=False), sa.Column("active", sa.Boolean(), nullable=False), sa.UniqueConstraint("course_id", "title", name="uq_lesson_course_title"))
    op.create_index("ix_lessons_course_id", "lessons", ["course_id"])
    op.create_index("ix_lessons_active", "lessons", ["active"])
    op.create_table("prompts", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False), sa.Column("content", sa.Text(), nullable=False), sa.Column("sort_order", sa.Integer(), nullable=False), sa.Column("active", sa.Boolean(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_prompts_lesson_id", "prompts", ["lesson_id"])
    op.create_index("ix_prompts_active", "prompts", ["active"])
    op.create_table("practice_attempts", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("child_id", sa.Integer(), sa.ForeignKey("child_profiles.id", ondelete="CASCADE"), nullable=False), sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="SET NULL"), nullable=True), sa.Column("lesson_id", sa.Integer(), sa.ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True), sa.Column("prompt_id", sa.Integer(), sa.ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True), sa.Column("prompt_snapshot", sa.Text(), nullable=False), sa.Column("duration_ms", sa.Integer(), nullable=False), sa.Column("char_count", sa.Integer(), nullable=False), sa.Column("error_count", sa.Integer(), nullable=False), sa.Column("cpm", sa.Integer(), nullable=False), sa.Column("accuracy", sa.Float(), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
    op.create_index("ix_practice_attempts_child_id", "practice_attempts", ["child_id"])
    op.create_index("ix_practice_attempts_created_at", "practice_attempts", ["created_at"])
    op.create_index("ix_attempt_child_created", "practice_attempts", ["child_id", "created_at"])
    op.create_index("ix_attempt_lesson_created", "practice_attempts", ["lesson_id", "created_at"])
    op.create_table("attempt_errors", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("attempt_id", sa.Integer(), sa.ForeignKey("practice_attempts.id", ondelete="CASCADE"), nullable=False), sa.Column("expected_char", sa.String(8), nullable=False), sa.Column("actual_char", sa.String(8), nullable=False), sa.Column("count", sa.Integer(), nullable=False))
    op.create_index("ix_attempt_errors_attempt_id", "attempt_errors", ["attempt_id"])


def downgrade() -> None:
    for table in ["attempt_errors", "practice_attempts", "prompts", "lessons", "courses", "auth_sessions", "child_profiles", "admins"]:
        op.drop_table(table)
