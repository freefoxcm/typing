import csv
import hashlib
import io
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .exercise_library import loads_json
from .models import (
    ChildProfile,
    ExerciseAnswer,
    ExerciseSession,
    ExerciseSessionItem,
    PracticeAttempt,
    WordSet,
    WrongQuestion,
)


def _round(value: float, digits: int = 1) -> float:
    return round(value, digits)


def _trend(current: float, previous: float | None, unit: str = "percentage_point") -> dict[str, Any]:
    return {
        "current": _round(current),
        "previous": _round(previous) if previous is not None else None,
        "delta": _round(current - previous) if previous is not None else None,
        "unit": unit,
    }


def _students(counts: dict[int, dict[str, Any]], names: dict[int, str]) -> list[dict[str, Any]]:
    return [
        {
            "child_id": child_id,
            "child_name": names.get(child_id, f"学生 {child_id}"),
            "count": values["count"],
            "last_at": values["last_at"],
        }
        for child_id, values in sorted(counts.items(), key=lambda item: (-item[1]["count"], names.get(item[0], "")))
    ]


def _add_student(target: dict[int, dict[str, Any]], child_id: int, count: int, occurred_at: datetime) -> None:
    item = target.setdefault(child_id, {"count": 0, "last_at": occurred_at})
    item["count"] += count
    item["last_at"] = max(item["last_at"], occurred_at)


def _typing_rows(
    current: list[PracticeAttempt],
    previous: list[PracticeAttempt],
    names: dict[int, str],
    limit: int | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    def aggregate(attempts: list[PracticeAttempt], pair: bool) -> tuple[dict[Any, dict[str, Any]], int]:
        result: dict[Any, dict[str, Any]] = {}
        total_errors = 0
        for attempt in attempts:
            for error in attempt.errors:
                key = (error.expected_char, error.actual_char) if pair else error.expected_char
                row = result.setdefault(key, {"error_count": 0, "attempt_ids": set(), "students": {}})
                row["error_count"] += error.count
                row["attempt_ids"].add(attempt.id)
                _add_student(row["students"], attempt.child_id, error.count, attempt.created_at)
                total_errors += error.count
        return result, total_errors

    def build(pair: bool) -> list[dict[str, Any]]:
        current_rows, current_total = aggregate(current, pair)
        previous_rows, previous_total = aggregate(previous, pair)
        rows: list[dict[str, Any]] = []
        for key, values in current_rows.items():
            previous_values = previous_rows.get(key)
            share = values["error_count"] / current_total * 100 if current_total else 0
            previous_share = previous_values["error_count"] / previous_total * 100 if previous_values and previous_total else None
            expected, actual = key if pair else (key, None)
            affected = len(values["students"])
            row = {
                "expected_char": expected,
                "error_count": values["error_count"],
                "error_share": _round(share),
                "sample_size": len(values["attempt_ids"]),
                "affected_student_count": affected,
                "small_sample": len(values["attempt_ids"]) < 3 or affected < 2,
                "students": _students(values["students"], names),
                "trend": _trend(share, previous_share),
                "recommendation": (
                    f"安排“{expected}”与“{actual}”的对比输入，强调键位位置和正确指法。"
                    if pair else f"安排包含“{expected}”的短句与重复击键练习，先保证准确再提升速度。"
                ),
            }
            if pair:
                row["actual_char"] = actual
            rows.append(row)
        rows.sort(key=lambda row: (-row["affected_student_count"], -row["error_share"], -row["error_count"], row["expected_char"]))
        return rows if limit is None else rows[:limit]

    return build(False), build(True)


def _word_rows(
    current: list[PracticeAttempt],
    previous: list[PracticeAttempt],
    names: dict[int, str],
    word_sets: dict[int, str],
    limit: int | None,
) -> list[dict[str, Any]]:
    def aggregate(attempts: list[PracticeAttempt]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for attempt in attempts:
            key = f"id:{attempt.word_id}" if attempt.word_id else f"snapshot:{attempt.prompt_snapshot.casefold()}"
            row = result.setdefault(key, {
                "word": attempt.prompt_snapshot,
                "word_id": attempt.word_id,
                "word_set_id": attempt.word_set_id,
                "attempt_count": 0,
                "wrong_attempt_count": 0,
                "char_count": 0,
                "error_count": 0,
                "students": {},
                "pairs": Counter(),
            })
            row["attempt_count"] += 1
            row["char_count"] += attempt.char_count
            row["error_count"] += attempt.error_count
            if attempt.error_count:
                row["wrong_attempt_count"] += 1
                _add_student(row["students"], attempt.child_id, attempt.error_count, attempt.created_at)
            for error in attempt.errors:
                row["pairs"][(error.expected_char, error.actual_char)] += error.count
        return result

    current_rows = aggregate(current)
    previous_rows = aggregate(previous)
    rows: list[dict[str, Any]] = []
    for key, values in current_rows.items():
        if not values["wrong_attempt_count"]:
            continue
        previous_values = previous_rows.get(key)
        wrong_rate = values["wrong_attempt_count"] / values["attempt_count"] * 100
        previous_rate = previous_values["wrong_attempt_count"] / previous_values["attempt_count"] * 100 if previous_values and previous_values["attempt_count"] else None
        accuracy = values["char_count"] / max(1, values["char_count"] + values["error_count"]) * 100
        affected = len(values["students"])
        rows.append({
            "word_key": key,
            "word_id": values["word_id"],
            "word": values["word"],
            "word_set_id": values["word_set_id"],
            "word_set_title": word_sets.get(values["word_set_id"], "历史单词集"),
            "attempt_count": values["attempt_count"],
            "wrong_attempt_count": values["wrong_attempt_count"],
            "wrong_rate": _round(wrong_rate),
            "average_accuracy": _round(accuracy),
            "error_count": values["error_count"],
            "affected_student_count": affected,
            "small_sample": values["attempt_count"] < 3 or affected < 2,
            "students": _students(values["students"], names),
            "top_confusions": [
                {"expected_char": pair[0], "actual_char": pair[1], "count": count}
                for pair, count in values["pairs"].most_common(3)
            ],
            "trend": _trend(wrong_rate, previous_rate),
            "recommendation": f"集中复练“{values['word']}”，按易错位置分段拼写，并结合听写与重复输入巩固。",
        })
    rows.sort(key=lambda row: (-row["affected_student_count"], -row["wrong_rate"], -row["wrong_attempt_count"], row["word"]))
    return rows if limit is None else rows[:limit]


def _question_key(item: ExerciseSessionItem, snapshot: dict[str, Any]) -> str:
    identifier = item.question_id or snapshot.get("id")
    if identifier:
        return f"id:{identifier}"
    source = "\0".join((str(snapshot.get("question_set_title") or ""), str(snapshot.get("type") or ""), str(snapshot.get("stem_markdown") or "")))
    return f"snapshot:{hashlib.sha256(source.encode('utf-8')).hexdigest()[:20]}"


def _correct_answer(snapshot: dict[str, Any]) -> str:
    kind = snapshot.get("type")
    if kind in {"single_choice", "multiple_choice"}:
        return "；".join(f"{option.get('label', '')} {option.get('content_markdown', '')}".strip() for option in snapshot.get("options", []) if option.get("correct"))
    if kind == "true_false":
        return "正确" if snapshot.get("correct_bool") else "错误"
    if kind == "fill_blank":
        return "；".join(f"第 {blank.get('position')} 空：{' / '.join(map(str, blank.get('accepted_answers', [])))}" for blank in snapshot.get("blanks", []))
    if kind == "programming":
        return "程序通过全部隐藏测试点"
    return ""


def _wrong_patterns(snapshot: dict[str, Any], answer: ExerciseAnswer | None) -> list[str]:
    kind = snapshot.get("type")
    values = loads_json(answer.answer_json, {}) if answer else {}
    if kind in {"single_choice", "multiple_choice"}:
        options = {int(option["id"]): option for option in snapshot.get("options", []) if option.get("id") is not None}
        selected = {int(value) for value in values.get("selected_option_ids", [])}
        correct = {identifier for identifier, option in options.items() if option.get("correct")}
        if kind == "single_choice":
            if not selected:
                return ["未作答"]
            return [f"误选 {options[value].get('label', '')}：{options[value].get('content_markdown', '')}" for value in selected if value in options and value not in correct]
        patterns = [f"多选 {options[value].get('label', '')}：{options[value].get('content_markdown', '')}" for value in sorted(selected - correct) if value in options]
        patterns.extend(f"漏选 {options[value].get('label', '')}：{options[value].get('content_markdown', '')}" for value in sorted(correct - selected) if value in options)
        return patterns or ["未作答"]
    if kind == "true_false":
        actual = values.get("bool_answer")
        return ["未作答" if actual is None else f"选择{'正确' if actual else '错误'}"]
    if kind == "fill_blank":
        actual = list(values.get("blank_answers", []))
        details = loads_json(answer.details_json, {}) if answer else {}
        correct = list(details.get("blank_correct", []))
        blank_count = len(snapshot.get("blanks", []))
        patterns = []
        for index in range(blank_count):
            value = actual[index] if index < len(actual) else ""
            if index >= len(correct) or not correct[index]:
                patterns.append(f"第 {index + 1} 空：{str(value).strip() or '未作答'}")
        return patterns or ["未作答"]
    if kind == "programming":
        return [answer.status if answer else "未作答"]
    return ["未作答"]


def _question_advice(kind: str, patterns: list[dict[str, Any]]) -> str:
    lead = patterns[0]["label"] if patterns else "常见错误"
    if kind in {"single_choice", "multiple_choice", "true_false"}:
        return f"围绕“{lead}”对比讲解正确概念与易混概念，并安排即时辨析题。"
    if kind == "fill_blank":
        return f"针对“{lead}”复习关键词、术语与拼写，再用同类填空即时检测。"
    if kind == "programming":
        return _programming_advice(lead)
    return "结合高频错误答案复讲核心概念，并安排一道同类变式题。"


def _programming_advice(status: str) -> str:
    return {
        "WA": "重点讲解输入输出格式、边界条件和样例外数据，并带领学生逐步对照期望输出。",
        "Syntax Error": "集中复习括号、冒号和缩进规则，安排短代码纠错练习。",
        "RE": "讲解常见运行时异常、输入校验和边界访问，示范如何阅读错误信息。",
        "TLE": "对比算法复杂度与数据规模，示范减少重复计算和选择更高效算法。",
        "MLE": "讲解数据结构内存占用，减少不必要的数据复制与缓存。",
        "unanswered": "先确认学生是否理解题意和输入输出要求，再拆分为可执行的小步骤。",
        "未作答": "先确认学生是否理解题意和输入输出要求，再拆分为可执行的小步骤。",
    }.get(status, "结合失败状态和测试结果进行逐步调试示范。")


def _question_rows(
    sessions: list[ExerciseSession],
    previous_sessions: list[ExerciseSession],
    names: dict[int, str],
    unresolved: dict[int, int],
    mode: str,
    limit: int | None,
) -> list[dict[str, Any]]:
    def aggregate(source: list[ExerciseSession]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for session in source:
            if (mode == "normal" and session.mode == "wrong") or (mode == "wrong" and session.mode != "wrong"):
                continue
            for item in session.items:
                snapshot = loads_json(item.snapshot_json, {})
                key = _question_key(item, snapshot)
                row = result.setdefault(key, {
                    "question_id": item.question_id or snapshot.get("id"),
                    "question_set_title": snapshot.get("question_set_title") or session.title,
                    "question_type": snapshot.get("type") or "unknown",
                    "stem_markdown": snapshot.get("stem_markdown") or "历史题目",
                    "correct_answer": _correct_answer(snapshot),
                    "attempt_count": 0,
                    "wrong_count": 0,
                    "students": {},
                    "patterns": Counter(),
                })
                row["attempt_count"] += 1
                wrong = not item.answer or item.answer.awarded_points != item.points
                if wrong:
                    row["wrong_count"] += 1
                    _add_student(row["students"], session.child_id, 1, session.completed_at or session.created_at)
                    row["patterns"].update(_wrong_patterns(snapshot, item.answer))
        return result

    current_rows = aggregate(sessions)
    previous_rows = aggregate(previous_sessions)
    rows: list[dict[str, Any]] = []
    for key, values in current_rows.items():
        if not values["wrong_count"]:
            continue
        previous = previous_rows.get(key)
        wrong_rate = values["wrong_count"] / values["attempt_count"] * 100
        previous_rate = previous["wrong_count"] / previous["attempt_count"] * 100 if previous and previous["attempt_count"] else None
        patterns = [{"label": label, "count": count} for label, count in values["patterns"].most_common(3)]
        affected = len(values["students"])
        question_id = values["question_id"]
        try:
            current_unmastered = unresolved.get(int(question_id), 0) if question_id else 0
        except (TypeError, ValueError):
            current_unmastered = 0
        rows.append({
            "question_key": key,
            "question_id": question_id,
            "question_set_title": values["question_set_title"],
            "question_type": values["question_type"],
            "stem_markdown": values["stem_markdown"],
            "correct_answer": values["correct_answer"],
            "attempt_count": values["attempt_count"],
            "wrong_count": values["wrong_count"],
            "wrong_rate": _round(wrong_rate),
            "affected_student_count": affected,
            "current_unmastered_count": current_unmastered,
            "small_sample": values["attempt_count"] < 3 or affected < 2,
            "students": _students(values["students"], names),
            "common_wrong_answers": patterns,
            "trend": _trend(wrong_rate, previous_rate),
            "recommendation": _question_advice(values["question_type"], patterns),
        })
    rows.sort(key=lambda row: (-row["affected_student_count"], -row["wrong_rate"], -row["wrong_count"], row["question_key"]))
    return rows if limit is None else rows[:limit]


def _programming_failures(
    current: list[ExerciseSession],
    previous: list[ExerciseSession],
    names: dict[int, str],
) -> list[dict[str, Any]]:
    def aggregate(sessions: list[ExerciseSession]) -> dict[str, dict[str, Any]]:
        result: dict[str, dict[str, Any]] = {}
        for session in sessions:
            if session.mode == "wrong":
                continue
            for item in session.items:
                snapshot = loads_json(item.snapshot_json, {})
                if snapshot.get("type") != "programming" or not item.answer or item.answer.status not in {"WA", "Syntax Error", "RE", "TLE", "MLE"}:
                    continue
                status = item.answer.status or "unanswered"
                row = result.setdefault(status, {"attempt_count": 0, "question_keys": set(), "students": {}})
                row["attempt_count"] += 1
                row["question_keys"].add(_question_key(item, snapshot))
                _add_student(row["students"], session.child_id, 1, session.completed_at or session.created_at)
        return result

    current_rows = aggregate(current)
    previous_rows = aggregate(previous)
    rows = []
    for status, values in current_rows.items():
        previous_count = previous_rows.get(status, {}).get("attempt_count")
        affected = len(values["students"])
        rows.append({
            "status": status,
            "attempt_count": values["attempt_count"],
            "question_count": len(values["question_keys"]),
            "affected_student_count": affected,
            "small_sample": values["attempt_count"] < 3 or affected < 2,
            "students": _students(values["students"], names),
            "trend": _trend(values["attempt_count"], previous_count, "count"),
            "recommendation": _programming_advice(status),
        })
    rows.sort(key=lambda row: (-row["affected_student_count"], -row["attempt_count"], row["status"]))
    return rows


def _insights(analysis: dict[str, Any]) -> list[dict[str, str]]:
    candidates: list[dict[str, Any]] = []
    weak = analysis["typing"]["weak_keys"]
    if weak and weak[0]["affected_student_count"] >= 2:
        item = weak[0]
        candidates.append({"category": "typing", "title": f"薄弱键：{item['expected_char']}", "description": f"影响 {item['affected_student_count']} 名学生，共误按 {item['error_count']} 次。", "recommendation": item["recommendation"]})
    pairs = analysis["typing"]["confusion_pairs"]
    if pairs and pairs[0]["affected_student_count"] >= 2:
        item = pairs[0]
        candidates.append({"category": "typing", "title": f"易混淆：{item['expected_char']} → {item['actual_char']}", "description": f"影响 {item['affected_student_count']} 名学生，共出现 {item['error_count']} 次。", "recommendation": item["recommendation"]})
    words = analysis["words"]["difficult_words"]
    if words and words[0]["affected_student_count"] >= 2:
        item = words[0]
        candidates.append({"category": "word", "title": f"易错单词：{item['word']}", "description": f"影响 {item['affected_student_count']} 名学生，错误作答率 {item['wrong_rate']}%。", "recommendation": item["recommendation"]})
    questions = analysis["exercises"]["difficult_questions"]
    if questions and questions[0]["affected_student_count"] >= 2:
        item = questions[0]
        candidates.append({"category": "exercise", "title": "高频易错题", "description": f"{item['question_set_title']}中有一道题影响 {item['affected_student_count']} 名学生，错误率 {item['wrong_rate']}%。", "recommendation": item["recommendation"]})
    programming = analysis["exercises"]["programming_failures"]
    if programming and programming[0]["affected_student_count"] >= 2:
        item = programming[0]
        candidates.append({"category": "exercise", "title": f"编程失败集中于 {item['status']}", "description": f"影响 {item['affected_student_count']} 名学生，共 {item['attempt_count']} 次。", "recommendation": item["recommendation"]})
    return candidates[:5]


def build_learning_analysis(db: Session, days: int, *, limit: int | None = 10, now: datetime | None = None) -> dict[str, Any]:
    end = now or datetime.utcnow()
    current_start = end - timedelta(days=days)
    previous_start = current_start - timedelta(days=days)
    names = dict(db.execute(select(ChildProfile.id, ChildProfile.name)).all())
    word_sets = dict(db.execute(select(WordSet.id, WordSet.title)).all())
    attempts = list(db.scalars(
        select(PracticeAttempt)
        .where(PracticeAttempt.created_at >= previous_start, PracticeAttempt.created_at <= end)
        .options(selectinload(PracticeAttempt.errors))
    ).all())
    sessions = list(db.scalars(
        select(ExerciseSession)
        .where(ExerciseSession.status == "completed", ExerciseSession.completed_at >= previous_start, ExerciseSession.completed_at <= end)
        .options(selectinload(ExerciseSession.items).selectinload(ExerciseSessionItem.answer))
    ).all())
    unresolved = dict(db.execute(
        select(WrongQuestion.question_id, func.count(WrongQuestion.id))
        .where(WrongQuestion.mastered.is_(False))
        .group_by(WrongQuestion.question_id)
    ).all())

    current_attempts = [item for item in attempts if item.created_at >= current_start]
    previous_attempts = [item for item in attempts if item.created_at < current_start]
    current_sessions = [item for item in sessions if item.completed_at and item.completed_at >= current_start]
    previous_sessions = [item for item in sessions if item.completed_at and item.completed_at < current_start]
    current_typing = [item for item in current_attempts if item.word_id is None]
    previous_typing = [item for item in previous_attempts if item.word_id is None]
    current_words = [item for item in current_attempts if item.word_id is not None]
    previous_words = [item for item in previous_attempts if item.word_id is not None]

    weak_keys, confusion_pairs = _typing_rows(current_typing, previous_typing, names, limit)
    difficult_words = _word_rows(current_words, previous_words, names, word_sets, limit)
    difficult_questions = _question_rows(current_sessions, previous_sessions, names, unresolved, "normal", limit)
    persistent_questions = _question_rows(current_sessions, previous_sessions, names, unresolved, "wrong", limit)
    programming_failures = _programming_failures(current_sessions, previous_sessions, names)

    total_chars = sum(item.char_count for item in current_attempts)
    total_errors = sum(item.error_count for item in current_attempts)
    exercise_items = [item for session in current_sessions for item in session.items]
    wrong_items = [item for item in exercise_items if not item.answer or item.answer.awarded_points != item.points]
    participants = {item.child_id for item in current_attempts} | {item.child_id for item in current_sessions}
    analysis = {
        "period": {
            "days": days,
            "current_start": current_start,
            "current_end": end,
            "previous_start": previous_start,
            "previous_end": current_start,
        },
        "summary": {
            "participating_students": len(participants),
            "typing_attempts": len(current_typing),
            "word_attempts": len(current_words),
            "practice_attempts": len(current_attempts),
            "practice_minutes": _round(sum(item.duration_ms for item in current_attempts) / 60000),
            "overall_accuracy": _round(total_chars / max(1, total_chars + total_errors) * 100),
            "completed_exercise_sessions": len(current_sessions),
            "exercise_question_attempts": len(exercise_items),
            "exercise_wrong_rate": _round(len(wrong_items) / len(exercise_items) * 100) if exercise_items else 0,
        },
        "typing": {"weak_keys": weak_keys, "confusion_pairs": confusion_pairs},
        "words": {"difficult_words": difficult_words},
        "exercises": {
            "difficult_questions": difficult_questions,
            "persistent_questions": persistent_questions,
            "programming_failures": programming_failures,
        },
    }
    analysis["insights"] = _insights(analysis)
    return analysis


def learning_analysis_csv(analysis: dict[str, Any], section: str) -> bytes:
    output = io.StringIO()
    writer = csv.writer(output)
    if section == "typing":
        writer.writerow(["category", "expected_char", "actual_char", "error_count", "error_share", "affected_students", "sample_size", "previous", "trend_delta", "students", "recommendation"])
        for category, items in (("weak_key", analysis["typing"]["weak_keys"]), ("confusion_pair", analysis["typing"]["confusion_pairs"])):
            for item in items:
                writer.writerow([category, item["expected_char"], item.get("actual_char", ""), item["error_count"], item["error_share"], item["affected_student_count"], item["sample_size"], item["trend"]["previous"], item["trend"]["delta"], _student_text(item["students"]), item["recommendation"]])
    elif section == "word":
        writer.writerow(["word", "word_set", "attempts", "wrong_attempts", "wrong_rate", "accuracy", "errors", "affected_students", "previous_rate", "trend_delta", "students", "recommendation"])
        for item in analysis["words"]["difficult_words"]:
            writer.writerow([item["word"], item["word_set_title"], item["attempt_count"], item["wrong_attempt_count"], item["wrong_rate"], item["average_accuracy"], item["error_count"], item["affected_student_count"], item["trend"]["previous"], item["trend"]["delta"], _student_text(item["students"]), item["recommendation"]])
    else:
        writer.writerow(["category", "question_set_or_status", "question_type", "question", "attempts", "wrong_attempts", "wrong_rate", "affected_students", "unmastered", "previous", "trend_delta", "common_errors", "students", "recommendation"])
        for category, items in (("difficult_question", analysis["exercises"]["difficult_questions"]), ("persistent_question", analysis["exercises"]["persistent_questions"])):
            for item in items:
                writer.writerow([category, item["question_set_title"], item["question_type"], item["stem_markdown"], item["attempt_count"], item["wrong_count"], item["wrong_rate"], item["affected_student_count"], item["current_unmastered_count"], item["trend"]["previous"], item["trend"]["delta"], "；".join(value["label"] for value in item["common_wrong_answers"]), _student_text(item["students"]), item["recommendation"]])
        for item in analysis["exercises"]["programming_failures"]:
            writer.writerow(["programming_failure", item["status"], "programming", "", item["attempt_count"], item["attempt_count"], "", item["affected_student_count"], "", item["trend"]["previous"], item["trend"]["delta"], item["status"], _student_text(item["students"]), item["recommendation"]])
    category = "word" if section == "word" else section
    priorities = [item for item in analysis["insights"] if item["category"] == category]
    if priorities:
        writer.writerow([])
        writer.writerow(["本周期教学重点", "问题", "分析", "教学建议"])
        for item in priorities:
            writer.writerow(["teaching_priority", item["title"], item["description"], item["recommendation"]])
    return output.getvalue().encode("utf-8-sig")


def _student_text(students: list[dict[str, Any]]) -> str:
    return "；".join(
        f"{item['child_name']}({item['count']}次，最近 {item['last_at'].isoformat() if isinstance(item['last_at'], datetime) else item['last_at']})"
        for item in students
    )
