import json

from app.exercise_imports import parse_exercise_import


def test_txt_import_supports_chinese_objective_questions_and_continuations():
    result = parse_exercise_import("txt", """题套：基础题
说明：入门练习
类型：单选题
题目：Python 中用于输出的函数是？
  可从以下选项中选择。
A. print
B. input
答案：A
解析：print 用于输出。
分值：2
---
类型：判断题
题目：列表是可变对象。
答案：正确
分值：2""")

    assert result.valid, result.errors
    assert result.counts == {"single_choice": 1, "multiple_choice": 0, "true_false": 1, "programming": 0}
    assert "以下选项" in result.question_sets[0].questions[0].stem_markdown
    assert result.question_sets[0].questions[0].reviewed is False


def test_csv_import_groups_sets_and_validates_answers():
    content = 'set_title,set_description,type,stem_markdown,options_json,answer,explanation_markdown,points\n基础题,选择题,多选题,"选择可变对象","[{""label"":""A"",""content"":""list""},{""label"":""B"",""content"":""tuple""},{""label"":""C"",""content"":""dict""}]","A|C",,4'
    result = parse_exercise_import("csv", content)

    assert result.valid, result.errors
    correct = [item.label for item in result.question_sets[0].questions[0].options if item.correct]
    assert correct == ["A", "C"]


def test_json_import_supports_full_programming_shape_and_forces_review():
    payload = {
        "version": 1,
        "question_sets": [{
            "title": "编程题",
            "questions": [{
                "id": 999,
                "type": "programming",
                "stem_markdown": "输出输入值",
                "explanation_markdown": "直接输出",
                "points": 10,
                "sort_order": 8,
                "reviewed": True,
                "source_asset_id": 123,
                "options": [],
                "programming": {
                    "input_markdown": "一个整数",
                    "output_markdown": "同一个整数",
                    "constraints_markdown": "1 <= n <= 10",
                    "starter_code": "n = int(input())",
                    "reference_solution": "print(input())",
                    "time_limit_ms": 1000,
                    "memory_limit_mb": 128,
                    "cases": [{"input_data": "1\n", "expected_output": "1\n", "is_sample": False, "weight": 10, "confirmed": True}],
                },
            }],
        }],
    }
    result = parse_exercise_import("json", json.dumps(payload, ensure_ascii=False))

    assert result.valid, result.errors
    question = result.question_sets[0].questions[0]
    assert question.type == "programming"
    assert question.reviewed is False
    assert question.source_asset_id is None
    assert question.programming.cases[0].confirmed is True


def test_txt_and_csv_reject_programming_questions_with_json_guidance():
    txt = parse_exercise_import("txt", "题套：编程题\n类型：编程题\n题目：输出 1\n分值：10")
    csv = parse_exercise_import("csv", "set_title,set_description,type,stem_markdown,options_json,answer,explanation_markdown,points\n编程题,,programming,输出 1,[],,,10")

    assert not txt.valid and any("改用 JSON" in item for item in txt.errors)
    assert not csv.valid and any("改用 JSON" in item for item in csv.errors)
