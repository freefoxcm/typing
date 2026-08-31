"""add stable question bundle migration keys

Revision ID: 0009_question_bundle_keys
Revises: 0008_question_stem_images
"""

from uuid import uuid4

from alembic import op
import sqlalchemy as sa


revision = "0009_question_bundle_keys"
down_revision = "0008_question_stem_images"
branch_labels = None
depends_on = None


def _backfill(table_name: str) -> None:
    connection = op.get_bind()
    table = sa.table(table_name, sa.column("id", sa.Integer), sa.column("migration_key", sa.String))
    for item_id in connection.execute(sa.select(table.c.id)).scalars():
        connection.execute(table.update().where(table.c.id == item_id).values(migration_key=uuid4().hex))


def upgrade() -> None:
    with op.batch_alter_table("question_sets") as batch_op:
        batch_op.add_column(sa.Column("migration_key", sa.String(length=32), nullable=True))
    with op.batch_alter_table("questions") as batch_op:
        batch_op.add_column(sa.Column("migration_key", sa.String(length=32), nullable=True))

    _backfill("question_sets")
    _backfill("questions")

    with op.batch_alter_table("question_sets") as batch_op:
        batch_op.alter_column("migration_key", nullable=False)
        batch_op.create_index("ix_question_sets_migration_key", ["migration_key"], unique=True)
    with op.batch_alter_table("questions") as batch_op:
        batch_op.alter_column("migration_key", nullable=False)
        batch_op.create_index("ix_questions_migration_key", ["migration_key"], unique=True)


def downgrade() -> None:
    with op.batch_alter_table("questions") as batch_op:
        batch_op.drop_index("ix_questions_migration_key")
        batch_op.drop_column("migration_key")
    with op.batch_alter_table("question_sets") as batch_op:
        batch_op.drop_index("ix_question_sets_migration_key")
        batch_op.drop_column("migration_key")
