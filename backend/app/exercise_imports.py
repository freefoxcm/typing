import csv
import io
import json
import re
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from .exercise_schemas import QuestionWrite


TYPE_ALIASES = {
    "single_choice": "single_choice", "single": "single_choice", "单选": "single_choice", "单选题": "single_choice",
    "multiple_choice": "multiple_choice", "multiple": "multiple_choice", "多选": "multiple_choice", "多选题": "multiple_choice",
    "true_false": "true_false", "boolean": "true_false", "判断": "true_false", "判断题": "true_false",
    "programming": "programming", "program": "programming", "编程": "programming", "编程题": "programming",
}
TRUE_VALUES = {"true", "1", "yes", "y", "对", "正确", "是"}
FALSE_VALUES = {"false", "0", "no", "n", "错", "错误", "否"}


@dataclass
class ImportedQuestionSet:
    title: str
    description: str
    questions: list[QuestionWrite]


@dataclass
class ExerciseImportResult:
    question_sets: list[ImportedQuestionSet] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return bool(self.question_sets) and not self.errors

    @property
    def counts(self) -> dict[str, int]:
        result = {kind: 0 for kind in ("single_choice", "multiple_choice", "true_false", "programming")}
        for question_set in self.question_sets:
            for question in question_set.questions:
                result[question.type] += 1
        return result


def _type(value: Any) -> str:
    return TYPE_ALIASES.get(str(value or "").strip().lower(), str(value or "").strip().lower())


def _bool_answer(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    normalized = str(value or "").strip().lower()
    if normalized in TRUE_VALUES:
        return True
    if normalized in FALSE_VALUES:
        return False
    return None


def _answer_labels(value: Any) -> set[str]:
    if isinstance(value, list):
        values = value
    else:
        values = re.split(r"[|,，、\s]+", str(value or ""))
    return {str(item).strip().upper() for item in values if str(item).strip()}


def _validation_message(prefix: str, exc: ValidationError) -> str:
    issue = exc.errors()[0]
    path = ".".join(str(item) for item in issue.get("loc", ()))
    return f"{prefix}{path + '：' if path else ''}{issue.get('msg', '内容无效')}"


def _question_from_mapping(raw: dict[str, Any], prefix: str, result: ExerciseImportResult, *, structured: bool) -> QuestionWrite | None:
    values = dict(raw)
    values["type"] = _type(values.get("type"))
    if not structured and values["type"] == "programming":
        result.errors.append(f"{prefix}TXT/CSV 不支持编程题，请改用 JSON")
        return None
    values["reviewed"] = False
    values["source_page"] = None
    values["source_asset_id"] = None
    values["show_source_crop"] = False
    try:
        return QuestionWrite.model_validate(values)
    except ValidationError as exc:
        result.errors.append(_validation_message(prefix, exc))
        return None


def _objective_question(raw: dict[str, Any], prefix: str, result: ExerciseImportResult) -> QuestionWrite | None:
    kind = _type(raw.get("type"))
    try:
        points = int(raw.get("points") or 1)
    except (TypeError, ValueError):
        result.errors.append(f"{prefix}分值必须是整数")
        return None
    values: dict[str, Any] = {
        "type": kind,
        "stem_markdown": str(raw.get("stem_markdown") or raw.get("stem") or "").strip(),
        "explanation_markdown": str(raw.get("explanation_markdown") or raw.get("explanation") or "").strip(),
        "points": points,
        "sort_order": int(raw.get("sort_order") or 0),
        "options": [],
        "programming": None,
    }
    if kind in {"single_choice", "multiple_choice"}:
        options = raw.get("options")
        if not isinstance(options, list):
            result.errors.append(f"{prefix}选择题必须提供选项")
            return None
        answers = _answer_labels(raw.get("answer"))
        values["options"] = [{
            "label": str(item.get("label") or chr(65 + index)).strip().upper(),
            "content_markdown": str(item.get("content_markdown") or item.get("content") or "").strip(),
            "correct": str(item.get("label") or chr(65 + index)).strip().upper() in answers,
            "sort_order": index,
        } for index, item in enumerate(options) if isinstance(item, dict)]
    elif kind == "true_false":
        values["correct_bool"] = _bool_answer(raw.get("answer"))
    return _question_from_mapping(values, prefix, result, structured=False)


def _parse_json(content: str, result: ExerciseImportResult) -> None:
    try:
        payload = json.loads(content)
    except json.JSONDecodeError as exc:
        result.errors.append(f"JSON 第 {exc.lineno} 行第 {exc.colno} 列：{exc.msg}")
        return
    if not isinstance(payload, dict) or payload.get("version") != 1 or not isinstance(payload.get("question_sets"), list):
        result.errors.append("JSON 必须包含 version: 1 和 question_sets 数组")
        return
    for set_index, raw_set in enumerate(payload["question_sets"], start=1):
        prefix = f"question_sets[{set_index - 1}]"
        if not isinstance(raw_set, dict):
            result.errors.append(f"{prefix}：题套必须是对象")
            continue
        title = str(raw_set.get("title") or "").strip()
        if not title:
            result.errors.append(f"{prefix}.title：题套名称不能为空")
            continue
        raw_questions = raw_set.get("questions")
        if not isinstance(raw_questions, list) or not raw_questions:
            result.errors.append(f"{prefix}.questions：题套至少需要一道题")
            continue
        questions: list[QuestionWrite] = []
        for question_index, raw in enumerate(raw_questions, start=1):
            if not isinstance(raw, dict):
                result.errors.append(f"{prefix}.questions[{question_index - 1}]：题目必须是对象")
                continue
            question = _question_from_mapping(raw, f"{prefix}.questions[{question_index - 1}].", result, structured=True)
            if question:
                question.sort_order = len(questions)
                questions.append(question)
        if questions:
            result.question_sets.append(ImportedQuestionSet(title[:180], str(raw_set.get("description") or "")[:5000], questions))


def _parse_csv(content: str, result: ExerciseImportResult) -> None:
    try:
        reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
        required = {"set_title", "type", "stem_markdown", "options_json", "answer", "explanation_markdown", "points"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            result.errors.append(f"CSV 缺少字段：{', '.join(sorted(missing))}")
            return
        grouped: dict[str, tuple[str, list[QuestionWrite]]] = {}
        for row_number, row in enumerate(reader, start=2):
            title = str(row.get("set_title") or "").strip()
            if not title:
                result.errors.append(f"CSV 第 {row_number} 行：set_title 不能为空")
                continue
            try:
                options = json.loads(row.get("options_json") or "[]")
            except json.JSONDecodeError as exc:
                result.errors.append(f"CSV 第 {row_number} 行 options_json：{exc.msg}")
                continue
            description = str(row.get("set_description") or "")
            target = grouped.setdefault(title, (description, []))[1]
            question = _objective_question({
                "type": row.get("type"), "stem_markdown": row.get("stem_markdown"), "options": options,
                "answer": row.get("answer"), "explanation_markdown": row.get("explanation_markdown"), "points": row.get("points"),
                "sort_order": len(target),
            }, f"CSV 第 {row_number} 行：", result)
            if question:
                question.sort_order = len(target)
                target.append(question)
        for title, (description, questions) in grouped.items():
            if questions:
                result.question_sets.append(ImportedQuestionSet(title[:180], description[:5000], questions))
    except csv.Error as exc:
        result.errors.append(f"CSV 格式错误：{exc}")


def _txt_value(line: str) -> tuple[str, str] | None:
    match = re.match(r"^\s*([^:：]+)\s*[:：]\s*(.*)$", line)
    return (match.group(1).strip(), match.group(2)) if match else None


def _parse_txt_question(lines: list[tuple[int, str]], result: ExerciseImportResult) -> QuestionWrite | None:
    if not lines:
        return None
    fields: dict[str, str] = {}
    options: list[dict[str, str]] = []
    last: tuple[str, int | None] | None = None
    aliases = {"类型": "type", "题目": "stem", "答案": "answer", "解析": "explanation", "分值": "points"}
    for line_number, line in lines:
        option = re.match(r"^\s*([A-Za-z])\s*[\.、:：]\s*(.*)$", line)
        pair = _txt_value(line)
        if option:
            options.append({"label": option.group(1).upper(), "content": option.group(2).strip()})
            last = ("option", len(options) - 1)
        elif pair and pair[0] in aliases:
            key = aliases[pair[0]]
            fields[key] = pair[1].strip()
            last = (key, None)
        elif line[:1].isspace() and last:
            if last[0] == "option" and last[1] is not None:
                options[last[1]]["content"] += "\n" + line.strip()
            else:
                fields[last[0]] = fields.get(last[0], "") + "\n" + line.strip()
        elif line.strip():
            result.errors.append(f"TXT 第 {line_number} 行：无法识别字段")
    return _objective_question({
        "type": fields.get("type"), "stem": fields.get("stem"), "answer": fields.get("answer"),
        "explanation": fields.get("explanation"), "points": fields.get("points") or 1, "options": options,
    }, f"TXT 第 {lines[0][0]} 行题目：", result)


def _parse_txt(content: str, result: ExerciseImportResult) -> None:
    current_title = ""
    current_description = ""
    current_questions: list[QuestionWrite] = []
    block: list[tuple[int, str]] = []

    def flush_block() -> None:
        nonlocal block
        question = _parse_txt_question(block, result)
        if question:
            question.sort_order = len(current_questions)
            current_questions.append(question)
        block = []

    def flush_set() -> None:
        nonlocal current_title, current_description, current_questions
        flush_block()
        if current_title and current_questions:
            result.question_sets.append(ImportedQuestionSet(current_title[:180], current_description[:5000], current_questions))
        elif current_questions:
            result.errors.append("TXT 缺少“题套：名称”")
        current_title, current_description, current_questions = "", "", []

    for line_number, line in enumerate(content.splitlines(), start=1):
        pair = _txt_value(line)
        if line.strip() == "---":
            flush_block()
        elif pair and pair[0] == "题套":
            if current_title or current_questions or block:
                flush_set()
            current_title = pair[1].strip()
            if not current_title:
                result.errors.append(f"TXT 第 {line_number} 行：题套名称不能为空")
        elif pair and pair[0] == "说明" and not block and not current_questions:
            current_description = pair[1].strip()
        elif line.strip():
            block.append((line_number, line))
    flush_set()


def parse_exercise_import(format_name: str, content: str) -> ExerciseImportResult:
    result = ExerciseImportResult()
    if format_name == "json":
        _parse_json(content, result)
    elif format_name == "csv":
        _parse_csv(content, result)
    elif format_name == "txt":
        _parse_txt(content, result)
    else:
        result.errors.append("不支持的导入格式")
    if not result.question_sets and not result.errors:
        result.errors.append("没有找到可导入的题目")
    return result
