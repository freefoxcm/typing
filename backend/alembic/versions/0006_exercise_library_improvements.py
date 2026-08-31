"""Add fill blanks and question recognition metadata."""

from alembic import op
import sqlalchemy as sa


revision = "0006_exercise_library_improvements"
down_revision = "0005_question_set_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("questions", sa.Column("source_end_page", sa.Integer(), nullable=True))
    op.add_column("questions", sa.Column("recognition_confidence", sa.Float(), nullable=True))
    op.add_column(
        "questions",
        sa.Column("recognition_warnings_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.create_table(
        "question_blanks",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("question_id", sa.Integer(), sa.ForeignKey("questions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("accepted_answers_json", sa.Text(), nullable=False, server_default="[]"),
        sa.UniqueConstraint("question_id", "position", name="uq_question_blank_position"),
    )
    op.create_index("ix_question_blanks_question_id", "question_blanks", ["question_id"])


def downgrade() -> None:
    op.drop_index("ix_question_blanks_question_id", table_name="question_blanks")
    op.drop_table("question_blanks")
    op.drop_column("questions", "recognition_warnings_json")
    op.drop_column("questions", "recognition_confidence")
    op.drop_column("questions", "source_end_page")
