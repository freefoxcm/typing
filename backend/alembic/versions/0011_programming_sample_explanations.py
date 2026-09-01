"""structure programming sample explanations

Revision ID: 0011_programming_sample_explanations
Revises: 0010_exercise_session_position
"""

from __future__ import annotations

import re

from alembic import op
import sqlalchemy as sa


revision = "0011_programming_sample_explanations"
down_revision = "0010_exercise_session_position"
branch_labels = None
depends_on = None


SAMPLE_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+样例(?:解释|说明)(?:[ \t]*([1-9]\d*))?[ \t]*$")
HEADING_RE = re.compile(r"^(#{1,6})[ \t]+")


def _extract(stem: str, cases: list[dict[str, object]]) -> tuple[str, list[dict[str, object]]]:
    public_indexes = [index for index, item in enumerate(cases) if bool(item["is_sample"])]
    lines = (stem or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: list[dict[str, object]] = []
    for start, line in enumerate(lines):
        match = SAMPLE_HEADING_RE.match(line.strip())
        if not match:
            continue
        level = len(match.group(1))
        end = len(lines)
        for cursor in range(start + 1, len(lines)):
            heading = HEADING_RE.match(lines[cursor].strip())
            if heading and len(heading.group(1)) <= level:
                end = cursor
                break
        number = int(match.group(2)) if match.group(2) else None
        target = None
        if number is not None and number <= len(public_indexes):
            target = public_indexes[number - 1]
        elif number is None and len(public_indexes) == 1:
            target = public_indexes[0]
        sections.append({"start": start, "end": end, "target": target, "content": "\n".join(lines[start + 1:end]).strip()})

    counts: dict[int, int] = {}
    for section in sections:
        target = section["target"]
        if isinstance(target, int):
            counts[target] = counts.get(target, 0) + 1
    removed: set[int] = set()
    for section in sections:
        target = section["target"]
        if not isinstance(target, int) or counts.get(target) != 1 or not section["content"]:
            continue
        if str(cases[target].get("explanation_markdown") or "").strip():
            continue
        cases[target]["explanation_markdown"] = section["content"]
        removed.update(range(int(section["start"]), int(section["end"])))
    if not removed:
        return stem, cases
    remaining = [line for index, line in enumerate(lines) if index not in removed]
    while remaining and not remaining[-1].strip():
        remaining.pop()
    return "\n".join(remaining).strip(), cases


def upgrade() -> None:
    with op.batch_alter_table("programming_cases") as batch_op:
        batch_op.add_column(sa.Column("explanation_markdown", sa.Text(), nullable=False, server_default=""))

    connection = op.get_bind()
    questions = connection.execute(sa.text(
        "SELECT q.id, q.stem_markdown FROM questions q "
        "JOIN programming_specs p ON p.question_id = q.id ORDER BY q.id"
    )).mappings().all()
    for question in questions:
        rows = connection.execute(sa.text(
            "SELECT id, is_sample, explanation_markdown FROM programming_cases "
            "WHERE question_id = :question_id ORDER BY id"
        ), {"question_id": question["id"]}).mappings().all()
        cases = [dict(row) for row in rows]
        original_explanations = {int(item["id"]): str(item.get("explanation_markdown") or "") for item in cases}
        stem, migrated = _extract(str(question["stem_markdown"] or ""), cases)
        if stem != question["stem_markdown"]:
            connection.execute(sa.text("UPDATE questions SET stem_markdown = :stem WHERE id = :id"), {"stem": stem, "id": question["id"]})
        for item in migrated:
            if str(item.get("explanation_markdown") or "") != original_explanations[int(item["id"])]:
                connection.execute(sa.text(
                    "UPDATE programming_cases SET explanation_markdown = :value WHERE id = :id"
                ), {"value": item["explanation_markdown"], "id": item["id"]})


def downgrade() -> None:
    with op.batch_alter_table("programming_cases") as batch_op:
        batch_op.drop_column("explanation_markdown")
