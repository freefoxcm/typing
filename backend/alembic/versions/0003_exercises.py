"""Add exercise question banks, sessions, imports, and judging records."""
from alembic import op
import sqlalchemy as sa


revision = "0003_exercises"
down_revision = "0002_word_practice"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "question_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("source_pdf_asset_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_question_sets_status", "question_sets", ["status"])
    op.create_table(
        "question_assets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_set_id", sa.Integer(), sa.ForeignKey("question_sets.id", ondelete="CASCADE"), nullable=True),
        sa.Column("storage_key", sa.String(255), nullable=False, unique=True),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(100), nullable=False),
        sa.Column("kind", sa.String(24), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_question_assets_question_set_id", "question_assets", ["question_set_id"])
    op.create_table(
        "question_import_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("source_asset_id", sa.Integer(), sa.ForeignKey("question_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_set_id", sa.Integer(), sa.ForeignKey("question_sets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("page_count", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_question_import_jobs_status", "question_import_jobs", ["status"])
    op.create_index("ix_question_import_jobs_source_asset_id", "question_import_jobs", ["source_asset_id"])
    op.create_table(
        "questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_set_id", sa.Integer(), sa.ForeignKey("question_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(24), nullable=False),
        sa.Column("stem_markdown", sa.Text(), nullable=False),
        sa.Column("explanation_markdown", sa.Text(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("reviewed", sa.Boolean(), nullable=False),
        sa.Column("correct_bool", sa.Boolean(), nullable=True),
        sa.Column("source_page", sa.Integer(), nullable=True),
        sa.Column("source_asset_id", sa.Integer(), sa.ForeignKey("question_assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("show_source_crop", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_questions_question_set_id", "questions", ["question_set_id"])
    op.create_index("ix_questions_type", "questions", ["type"])
    op.create_index("ix_questions_reviewed", "questions", ["reviewed"])
    op.create_table(
        "question_options",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(16), nullable=False),
        sa.Column("content_markdown", sa.Text(), nullable=False),
        sa.Column("correct", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
    )
    op.create_index("ix_question_options_question_id", "question_options", ["question_id"])
    op.create_table(
        "programming_specs",
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("input_markdown", sa.Text(), nullable=False),
        sa.Column("output_markdown", sa.Text(), nullable=False),
        sa.Column("constraints_markdown", sa.Text(), nullable=False),
        sa.Column("starter_code", sa.Text(), nullable=False),
        sa.Column("reference_solution", sa.Text(), nullable=False),
        sa.Column("time_limit_ms", sa.Integer(), nullable=False),
        sa.Column("memory_limit_mb", sa.Integer(), nullable=False),
    )
    op.create_table(
        "programming_cases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("programming_specs.question_id", ondelete="CASCADE"), nullable=False),
        sa.Column("input_data", sa.Text(), nullable=False),
        sa.Column("expected_output", sa.Text(), nullable=False),
        sa.Column("is_sample", sa.Boolean(), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False),
        sa.Column("confirmed", sa.Boolean(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
    )
    op.create_index("ix_programming_cases_question_id", "programming_cases", ["question_id"])
    op.create_index("ix_programming_cases_is_sample", "programming_cases", ["is_sample"])
    op.create_table(
        "exercise_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("child_id", sa.Integer(), sa.ForeignKey("child_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mode", sa.String(16), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("config_json", sa.Text(), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("score", sa.Integer(), nullable=False),
        sa.Column("max_score", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("submitted_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_exercise_sessions_child_id", "exercise_sessions", ["child_id"])
    op.create_index("ix_exercise_sessions_status", "exercise_sessions", ["status"])
    op.create_index("ix_exercise_session_child_created", "exercise_sessions", ["child_id", "created_at"])
    op.create_table(
        "exercise_session_items",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("exercise_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("question_set_id", sa.Integer(), sa.ForeignKey("question_sets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("snapshot_json", sa.Text(), nullable=False),
        sa.UniqueConstraint("session_id", "sort_order", name="uq_exercise_session_item_order"),
    )
    op.create_index("ix_exercise_session_items_session_id", "exercise_session_items", ["session_id"])
    op.create_index("ix_exercise_session_items_question_id", "exercise_session_items", ["question_id"])
    op.create_table(
        "exercise_answers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_item_id", sa.Integer(), sa.ForeignKey("exercise_session_items.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("answer_json", sa.Text(), nullable=False),
        sa.Column("code", sa.Text(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("awarded_points", sa.Integer(), nullable=False),
        sa.Column("details_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_exercise_answers_session_item_id", "exercise_answers", ["session_item_id"], unique=True)
    op.create_table(
        "wrong_questions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("child_id", sa.Integer(), sa.ForeignKey("child_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("wrong_count", sa.Integer(), nullable=False),
        sa.Column("mastered", sa.Boolean(), nullable=False),
        sa.Column("last_wrong_at", sa.DateTime(), nullable=False),
        sa.Column("mastered_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("child_id", "question_id", name="uq_wrong_child_question"),
    )
    op.create_index("ix_wrong_questions_child_id", "wrong_questions", ["child_id"])
    op.create_index("ix_wrong_questions_question_id", "wrong_questions", ["question_id"])
    op.create_index("ix_wrong_questions_mastered", "wrong_questions", ["mastered"])


def downgrade() -> None:
    for table in [
        "wrong_questions", "exercise_answers", "exercise_session_items", "exercise_sessions",
        "programming_cases", "programming_specs", "question_options", "questions",
        "question_import_jobs", "question_assets", "question_sets",
    ]:
        op.drop_table(table)
