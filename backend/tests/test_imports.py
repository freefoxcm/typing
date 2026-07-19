import json

from app.imports import parse_import, validate_prompt


def test_prompt_validation_accepts_ascii_code_and_controls():
    assert validate_prompt('for i in range(3):\n\tprint(i)') is None
    assert validate_prompt('你好') is not None
    assert validate_prompt('bad\x00value') is not None


def test_txt_import_skips_blank_lines():
    result = parse_import('txt', 'alpha\n\nbeta', 'Basics')
    assert result.summary()['valid'] is True
    assert [item.prompt for item in result.items] == ['alpha', 'beta']


def test_csv_requires_columns_and_valid_order():
    bad = parse_import('csv', 'title,prompt\nx,y')
    assert bad.errors
    good = parse_import('csv', 'course,lesson,prompt,order,enabled\nStarter,Home,asdf,2,false')
    assert not good.errors
    assert good.items[0].order == 2
    assert good.items[0].enabled is False


def test_json_import_supports_multiline_prompts():
    payload = {'courses': [{'title': 'Code', 'lessons': [{'title': 'Python', 'prompts': [{'content': 'if ok:\n\tprint(ok)'}]}]}]}
    result = parse_import('json', json.dumps(payload))
    assert not result.errors
    assert result.items[0].prompt.endswith('print(ok)')

