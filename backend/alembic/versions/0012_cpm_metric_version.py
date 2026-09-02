"""version typing speed metrics

Revision ID: 0012_cpm_metric_version
Revises: 0011_programming_sample_explanations
"""

from alembic import op
import sqlalchemy as sa


revision = "0012_cpm_metric_version"
down_revision = "0011_programming_sample_explanations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.add_column(sa.Column("speed_char_count", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("metric_version", sa.Integer(), nullable=False, server_default="1"))
        batch_op.alter_column("cpm", existing_type=sa.Integer(), nullable=True)

    op.execute("UPDATE practice_attempts SET speed_char_count = char_count")
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.alter_column("speed_char_count", existing_type=sa.Integer(), nullable=False)


def downgrade() -> None:
    op.execute("UPDATE practice_attempts SET cpm = 0 WHERE cpm IS NULL")
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.alter_column("cpm", existing_type=sa.Integer(), nullable=False)
        batch_op.drop_column("metric_version")
        batch_op.drop_column("speed_char_count")
