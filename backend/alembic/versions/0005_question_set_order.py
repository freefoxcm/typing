"""Add explicit question set ordering."""

from alembic import op
import sqlalchemy as sa


revision = "0005_question_set_order"
down_revision = "0004_question_import_diagnostics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "question_sets",
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
    )
    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id FROM question_sets ORDER BY created_at DESC, id DESC")
    ).fetchall()
    for sort_order, row in enumerate(rows):
        connection.execute(
            sa.text("UPDATE question_sets SET sort_order = :sort_order WHERE id = :id"),
            {"sort_order": sort_order, "id": row.id},
        )


def downgrade() -> None:
    op.drop_column("question_sets", "sort_order")
