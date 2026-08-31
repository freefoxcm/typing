"""add question stem images

Revision ID: 0008_question_stem_images
Revises: 0007_question_recognition_jobs
"""

from alembic import op
import sqlalchemy as sa


revision = "0008_question_stem_images"
down_revision = "0007_question_recognition_jobs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("questions") as batch_op:
        batch_op.add_column(sa.Column("stem_image_asset_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_questions_stem_image_asset_id_question_assets",
            "question_assets",
            ["stem_image_asset_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("questions") as batch_op:
        batch_op.drop_constraint("fk_questions_stem_image_asset_id_question_assets", type_="foreignkey")
        batch_op.drop_column("stem_image_asset_id")
