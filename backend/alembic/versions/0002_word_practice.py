"""Add word sets, words, and word practice attempt links."""
from alembic import op
import sqlalchemy as sa

revision = "0002_word_practice"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "word_sets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("title"),
    )
    op.create_index("ix_word_sets_active", "word_sets", ["active"])
    op.create_table(
        "words",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("word_set_id", sa.Integer(), sa.ForeignKey("word_sets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("spelling", sa.String(120), nullable=False),
        sa.Column("normalized_spelling", sa.String(120), nullable=False),
        sa.Column("phonetic", sa.String(160), nullable=False),
        sa.Column("meaning_zh", sa.Text(), nullable=False),
        sa.Column("technical_meaning_zh", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("enrichment_status", sa.String(16), nullable=False),
        sa.Column("enrichment_attempts", sa.Integer(), nullable=False),
        sa.Column("enrichment_error", sa.Text(), nullable=False),
        sa.Column("next_retry_at", sa.DateTime(), nullable=True),
        sa.Column("processing_started_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("word_set_id", "normalized_spelling", name="uq_word_set_normalized_spelling"),
    )
    op.create_index("ix_words_word_set_id", "words", ["word_set_id"])
    op.create_index("ix_words_active", "words", ["active"])
    op.create_index("ix_words_enrichment_status", "words", ["enrichment_status"])
    op.create_index("ix_words_enrichment_queue", "words", ["enrichment_status", "next_retry_at"])
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.add_column(sa.Column("word_set_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("word_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key("fk_attempt_word_set", "word_sets", ["word_set_id"], ["id"], ondelete="SET NULL")
        batch_op.create_foreign_key("fk_attempt_word", "words", ["word_id"], ["id"], ondelete="SET NULL")
        batch_op.create_index("ix_practice_attempts_word_set_id", ["word_set_id"])
        batch_op.create_index("ix_practice_attempts_word_id", ["word_id"])


def downgrade() -> None:
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.drop_index("ix_practice_attempts_word_id")
        batch_op.drop_index("ix_practice_attempts_word_set_id")
        batch_op.drop_constraint("fk_attempt_word", type_="foreignkey")
        batch_op.drop_constraint("fk_attempt_word_set", type_="foreignkey")
        batch_op.drop_column("word_id")
        batch_op.drop_column("word_set_id")
    op.drop_table("words")
    op.drop_table("word_sets")
