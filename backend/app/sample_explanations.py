from __future__ import annotations

import re
from typing import Any


SAMPLE_EXPLANATION_HEADING_RE = re.compile(
    r"^(#{1,6})[ \t]+样例(?:解释|说明)(?:[ \t]*([1-9]\d*))?[ \t]*$"
)
MARKDOWN_HEADING_RE = re.compile(r"^(#{1,6})[ \t]+")


def extract_sample_explanations(
    stem_markdown: str,
    cases: list[dict[str, Any]],
) -> tuple[str, list[dict[str, Any]], list[str]]:
    """Move clearly matched sample explanation sections out of a question stem.

    Ambiguous, duplicate, out-of-range, or already-populated sections remain in
    the stem so recognition/import can never discard source content.
    """
    public_indexes = [index for index, item in enumerate(cases) if bool(item.get("is_sample"))]
    lines = str(stem_markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    sections: list[dict[str, Any]] = []
    for start, line in enumerate(lines):
        match = SAMPLE_EXPLANATION_HEADING_RE.match(line.strip())
        if not match:
            continue
        level = len(match.group(1))
        end = len(lines)
        for cursor in range(start + 1, len(lines)):
            next_heading = MARKDOWN_HEADING_RE.match(lines[cursor].strip())
            if next_heading and len(next_heading.group(1)) <= level:
                end = cursor
                break
        number = int(match.group(2)) if match.group(2) else None
        target = None
        if number is not None and number <= len(public_indexes):
            target = public_indexes[number - 1]
        elif number is None and len(public_indexes) == 1:
            target = public_indexes[0]
        sections.append({
            "start": start,
            "end": end,
            "number": number,
            "target": target,
            "content": "\n".join(lines[start + 1:end]).strip(),
        })

    target_counts: dict[int, int] = {}
    for section in sections:
        if section["target"] is not None:
            target_counts[section["target"]] = target_counts.get(section["target"], 0) + 1

    removed: set[int] = set()
    warnings: list[str] = []
    for section in sections:
        target = section["target"]
        label = f"样例解释 {section['number']}" if section["number"] is not None else "样例解释"
        if target is None:
            warnings.append(f"{label}无法对应公开样例，已保留在题面")
            continue
        if target_counts.get(target, 0) != 1:
            warnings.append(f"{label}存在重复标题，已保留在题面")
            continue
        if not section["content"]:
            warnings.append(f"{label}内容为空，已保留在题面")
            continue
        if str(cases[target].get("explanation_markdown") or "").strip():
            warnings.append(f"{label}与结构化解释重复，已保留在题面")
            continue
        cases[target]["explanation_markdown"] = section["content"]
        removed.update(range(section["start"], section["end"]))

    if not removed:
        return stem_markdown, cases, warnings
    remaining = [line for index, line in enumerate(lines) if index not in removed]
    while remaining and not remaining[-1].strip():
        remaining.pop()
    return "\n".join(remaining).strip(), cases, warnings


def structure_candidate_sample_explanations(raw: dict[str, Any]) -> dict[str, Any]:
    program = raw.get("programming")
    if not isinstance(program, dict) or not isinstance(program.get("cases"), list):
        return raw
    cases = [item for item in program["cases"] if isinstance(item, dict)]
    if len(cases) != len(program["cases"]):
        return raw
    stem, _, warnings = extract_sample_explanations(str(raw.get("stem_markdown") or ""), cases)
    raw["stem_markdown"] = stem
    if warnings:
        raw.setdefault("_recognition_warnings", []).extend(warnings)
    return raw
