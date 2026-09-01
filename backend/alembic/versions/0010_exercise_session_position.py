"""remember the last visited exercise item

Revision ID: 0010_exercise_session_position
Revises: 0009_question_bundle_keys
"""

from alembic import op
import sqlalchemy as sa


revision = "0010_exercise_session_position"
down_revision = "0009_question_bundle_keys"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("exercise_sessions") as batch_op:
        batch_op.add_column(sa.Column("current_item_sort_order", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("exercise_sessions") as batch_op:
        batch_op.drop_column("current_item_sort_order")
