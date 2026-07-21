"""Add structured PDF import diagnostics."""

from alembic import op
import sqlalchemy as sa


revision = "0004_question_import_diagnostics"
down_revision = "0003_exercises"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "question_import_jobs",
        sa.Column("diagnostics_json", sa.Text(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("question_import_jobs", "diagnostics_json")
