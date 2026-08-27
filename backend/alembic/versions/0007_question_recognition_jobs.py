"""Add persistent question re-recognition jobs and source identity."""

from alembic import op
import sqlalchemy as sa


revision = "0007_question_recognition_jobs"
down_revision = "0006_exercise_library_improvements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("source_section", sa.String(length=180), nullable=False, server_default=""))
    op.add_column("questions", sa.Column("source_number", sa.String(length=80), nullable=False, server_default=""))
    op.create_table(
        "question_recognition_jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("target_set_id", sa.Integer(), sa.ForeignKey("question_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("source_asset_id", sa.Integer(), sa.ForeignKey("question_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=180), nullable=False, server_default=""),
        sa.Column("base_url", sa.String(length=500), nullable=False, server_default=""),
        sa.Column("reasoning_effort", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("result_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("diagnostics_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
        sa.Column("applied_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_question_recognition_jobs_scope", "question_recognition_jobs", ["scope"])
    op.create_index("ix_question_recognition_jobs_status", "question_recognition_jobs", ["status"])
    op.create_index("ix_question_recognition_jobs_target_set_id", "question_recognition_jobs", ["target_set_id"])
    op.create_index("ix_question_recognition_jobs_target_question_id", "question_recognition_jobs", ["target_question_id"])
    op.create_index("ix_question_recognition_jobs_source_asset_id", "question_recognition_jobs", ["source_asset_id"])


def downgrade() -> None:
    op.drop_table("question_recognition_jobs")
    op.drop_column("questions", "source_number")
    op.drop_column("questions", "source_section")
