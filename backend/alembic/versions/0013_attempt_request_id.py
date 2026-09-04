"""deduplicate retried practice results"""

from alembic import op
import sqlalchemy as sa

revision = "0013_attempt_request_id"
down_revision = "0012_cpm_metric_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("practice_attempts", sa.Column("request_id", sa.String(64), nullable=True))
    op.add_column("practice_attempts", sa.Column("request_fingerprint", sa.String(64), nullable=True))
    op.create_index("uq_attempt_child_request", "practice_attempts", ["child_id", "request_id"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_attempt_child_request", table_name="practice_attempts")
    with op.batch_alter_table("practice_attempts") as batch_op:
        batch_op.drop_column("request_fingerprint")
        batch_op.drop_column("request_id")
