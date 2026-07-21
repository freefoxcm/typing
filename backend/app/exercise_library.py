import json
from typing import Any

from .exercise_schemas import QuestionWrite
from .models import ProgrammingCase, ProgrammingSpec, Question, QuestionOption, QuestionSet


QUESTION_TYPES = {"single_choice", "multiple_choice", "true_false", "programming"}


def option_dict(item: QuestionOption, include_correct: bool) -> dict[str, Any]:
    result = {
        "id": item.id,
        "label": item.label,
        "content_markdown": item.content_markdown,
        "sort_order": item.sort_order,
    }
    if include_correct:
        result["correct"] = item.correct
    return result


def case_dict(item: ProgrammingCase, include_hidden: bool) -> dict[str, Any] | None:
    if not item.is_sample and not include_hidden:
        return None
    result = {
        "id": item.id,
        "input_data": item.input_data,
        "expected_output": item.expected_output,
        "is_sample": item.is_sample,
        "weight": item.weight,
    }
    if include_hidden:
        result.update({"confirmed": item.confirmed, "note": item.note})
    return result


def question_dict(question: Question, include_answers: bool = True) -> dict[str, Any]:
    result: dict[str, Any] = {
        "id": question.id,
        "question_set_id": question.question_set_id,
        "type": question.type,
        "stem_markdown": question.stem_markdown,
        "explanation_markdown": question.explanation_markdown if include_answers else "",
        "points": question.points,
        "sort_order": question.sort_order,
        "source_page": question.source_page,
        "source_asset_id": question.source_asset_id,
        "show_source_crop": question.show_source_crop,
        "options": [option_dict(item, include_answers) for item in question.options],
    }
    if include_answers:
        result.update({"reviewed": question.reviewed, "correct_bool": question.correct_bool})
    if question.programming:
        cases = [case_dict(item, include_answers) for item in question.programming.cases]
        result["programming"] = {
            "input_markdown": question.programming.input_markdown,
            "output_markdown": question.programming.output_markdown,
            "constraints_markdown": question.programming.constraints_markdown,
            "starter_code": question.programming.starter_code,
            "reference_solution": question.programming.reference_solution if include_answers else "",
            "time_limit_ms": question.programming.time_limit_ms,
            "memory_limit_mb": question.programming.memory_limit_mb,
            "cases": [item for item in cases if item is not None],
        }
    else:
        result["programming"] = None
    return result


def question_set_dict(question_set: QuestionSet, include_questions: bool = True) -> dict[str, Any]:
    counts = {kind: 0 for kind in QUESTION_TYPES}
    for question in question_set.questions:
        counts[question.type] = counts.get(question.type, 0) + 1
    result: dict[str, Any] = {
        "id": question_set.id,
        "title": question_set.title,
        "description": question_set.description,
        "status": question_set.status,
        "source_pdf_asset_id": question_set.source_pdf_asset_id,
        "question_count": len(question_set.questions),
        "counts": counts,
        "total_points": sum(item.points for item in question_set.questions),
        "created_at": question_set.created_at,
        "updated_at": question_set.updated_at,
        "published_at": question_set.published_at,
    }
    if include_questions:
        result["questions"] = [question_dict(item) for item in question_set.questions]
    return result


def replace_question(question: Question, payload: QuestionWrite) -> None:
    question.type = payload.type
    question.stem_markdown = payload.stem_markdown
    question.explanation_markdown = payload.explanation_markdown
    question.points = payload.points
    question.sort_order = payload.sort_order
    question.reviewed = payload.reviewed
    question.correct_bool = payload.correct_bool if payload.type == "true_false" else None
    question.source_page = payload.source_page
    question.source_asset_id = payload.source_asset_id
    question.show_source_crop = payload.show_source_crop
    question.options = [QuestionOption(**item.model_dump()) for item in payload.options] if payload.type in {"single_choice", "multiple_choice"} else []
    if payload.type == "programming" and payload.programming:
        values = payload.programming.model_dump(exclude={"cases"})
        spec = question.programming or ProgrammingSpec()
        for key, value in values.items():
            setattr(spec, key, value)
        spec.cases = [ProgrammingCase(**item.model_dump()) for item in payload.programming.cases]
        question.programming = spec
    else:
        question.programming = None


def publication_errors(question_set: QuestionSet) -> list[str]:
    errors: list[str] = []
    if not question_set.questions:
        return ["题套至少需要一道题"]
    for index, question in enumerate(question_set.questions, start=1):
        prefix = f"第 {index} 题"
        if not question.reviewed:
            errors.append(f"{prefix}尚未复核")
        if question.points <= 0:
            errors.append(f"{prefix}分值必须大于零")
        if question.type in {"single_choice", "multiple_choice"}:
            correct = sum(item.correct for item in question.options)
            if len(question.options) < 2:
                errors.append(f"{prefix}至少需要两个选项")
            if question.type == "single_choice" and correct != 1:
                errors.append(f"{prefix}必须且只能有一个正确选项")
            if question.type == "multiple_choice" and correct < 1:
                errors.append(f"{prefix}至少需要一个正确选项")
        elif question.type == "true_false" and question.correct_bool is None:
            errors.append(f"{prefix}缺少判断答案")
        elif question.type == "programming":
            if not question.programming or not question.programming.reference_solution.strip():
                errors.append(f"{prefix}缺少参考程序")
                continue
            hidden = [case for case in question.programming.cases if not case.is_sample and case.confirmed]
            if not hidden:
                errors.append(f"{prefix}至少需要一个已确认隐藏测试点")
            elif sum(case.weight for case in hidden) != question.points:
                errors.append(f"{prefix}隐藏测试点权重之和必须等于题目分值")
    return errors


def question_snapshot(question: Question, set_title: str) -> dict[str, Any]:
    data = question_dict(question, include_answers=True)
    data["question_set_title"] = set_title
    return data


def loads_json(value: str, default: Any) -> Any:
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return default
