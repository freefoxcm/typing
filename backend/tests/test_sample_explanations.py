from app.sample_explanations import extract_sample_explanations, structure_candidate_sample_explanations


def test_extracts_numbered_sections_in_public_case_order():
    cases = [
        {"is_sample": True, "explanation_markdown": ""},
        {"is_sample": False, "explanation_markdown": ""},
        {"is_sample": True, "explanation_markdown": ""},
    ]
    stem, result, warnings = extract_sample_explanations(
        "题面\n\n### 样例解释 1\n第一段 **说明**。\n\n### 样例说明 2\n第二段 $H_1$。",
        cases,
    )
    assert stem == "题面"
    assert result[0]["explanation_markdown"] == "第一段 **说明**。"
    assert result[2]["explanation_markdown"] == "第二段 $H_1$。"
    assert warnings == []


def test_extracts_unnumbered_section_only_for_one_public_sample():
    stem, cases, warnings = extract_sample_explanations(
        "题面\n## 样例解释\n唯一说明",
        [{"is_sample": True, "explanation_markdown": ""}],
    )
    assert stem == "题面"
    assert cases[0]["explanation_markdown"] == "唯一说明"
    assert warnings == []


def test_ambiguous_sections_are_preserved_without_overwriting():
    original = "题面\n### 样例解释 1\n第一段\n### 样例解释 1\n重复段\n### 样例解释 3\n越界段"
    stem, cases, warnings = extract_sample_explanations(
        original,
        [{"is_sample": True, "explanation_markdown": "已有解释"}, {"is_sample": True, "explanation_markdown": ""}],
    )
    assert stem == original
    assert cases[0]["explanation_markdown"] == "已有解释"
    assert cases[1]["explanation_markdown"] == ""
    assert len(warnings) == 3


def test_candidate_structure_adds_review_warning_for_unmatched_section():
    raw = {
        "stem_markdown": "题面\n### 样例解释 2\n无法匹配",
        "programming": {"cases": [{"is_sample": True, "explanation_markdown": ""}]},
    }
    structure_candidate_sample_explanations(raw)
    assert "样例解释 2" in raw["stem_markdown"]
    assert "已保留在题面" in raw["_recognition_warnings"][0]
