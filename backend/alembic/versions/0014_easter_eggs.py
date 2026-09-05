"""Learning rewards and timed game sessions."""
from alembic import op
import sqlalchemy as sa

revision = "0014_easter_eggs"
down_revision = "0013_attempt_request_id"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("easter_egg_settings", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("config_json", sa.Text(), nullable=False))
    op.create_table("easter_egg_rewards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("child_id", sa.Integer(), sa.ForeignKey("child_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("reward_date", sa.String(10), nullable=False),
        sa.Column("source_session_id", sa.Integer(), sa.ForeignKey("exercise_sessions.id", ondelete="SET NULL")),
        sa.Column("config_json", sa.Text(), nullable=False), sa.Column("games_json", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False), sa.Column("display_version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("child_id", "reward_date", name="uq_reward_child_date"))
    op.create_index("ix_easter_egg_rewards_child_id", "easter_egg_rewards", ["child_id"])
    op.create_table("easter_egg_play_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("reward_id", sa.Integer(), sa.ForeignKey("easter_egg_rewards.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("started_at", sa.DateTime(), nullable=False), sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("game_id", sa.String(32), nullable=False), sa.Column("instance_id", sa.String(64), nullable=False),
        sa.Column("lease_until", sa.DateTime(), nullable=False))


def downgrade():
    op.drop_table("easter_egg_play_sessions")
    op.drop_table("easter_egg_rewards")
    op.drop_table("easter_egg_settings")
