import sys

import worker


def run(code: str, expected: str = "") -> dict:
    worker.PYTHON = sys.executable
    return worker.run_case(code, {"id": 1, "input": "2 3\n", "expected": expected, "weight": 5}, "submission", 500, 128, 65536)


def test_normalizes_line_endings_and_trailing_whitespace():
    assert worker.normalize_output("a  \r\n\r\n") == "a"


def test_accepts_correct_output_and_rejects_wrong_output():
    assert run("a,b=map(int,input().split());print(a+b)", "5\n")["status"] == "AC"
    assert run("print(4)", "5\n")["status"] == "WA"


def test_reports_syntax_runtime_and_timeout():
    assert run("if True print('x')")["status"] == "Syntax Error"
    assert run("for _ in range(1):\nprint('x')")["status"] == "Syntax Error"
    assert run("raise RuntimeError('boom')")["status"] == "RE"
    assert run("while True: pass")["status"] == "TLE"


def test_reference_mode_returns_captured_output():
    worker.PYTHON = sys.executable
    result = worker.run_case("print(int(input()) * 2)", {"id": 9, "input": "6\n", "weight": 0}, "reference", 500, 128, 65536)
    assert result["status"] == "AC"
    assert worker.normalize_output(result["stdout"]) == "12"


def test_reference_execution_detects_unstable_output(monkeypatch):
    outputs = iter(["first\n", "second\n"])

    def fake_run_case(code, case, kind, time_ms, memory_mb, output_limit):
        return {"id": case["id"], "status": "AC", "duration_ms": 1, "weight": 0, "stdout": next(outputs), "stderr": ""}

    monkeypatch.setattr(worker, "run_case", fake_run_case)
    result = worker.execute({"kind": "reference", "code": "", "cases": [{"id": 1, "input": ""}], "repeat_count": 2})
    assert result["cases"][0]["stable"] is False
    assert result["cases"][0]["status"] == "Unstable"
