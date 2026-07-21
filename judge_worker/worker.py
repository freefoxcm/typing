import json
import math
import os
import signal
import subprocess
import tempfile
import time
from pathlib import Path

if os.name == "posix":
    import grp


QUEUE_ROOT = Path(os.environ.get("JUDGE_QUEUE_DIR", "/queue"))
INCOMING = QUEUE_ROOT / "incoming"
OUTGOING = QUEUE_ROOT / "outgoing"
PYTHON = os.environ.get("JUDGE_PYTHON", "/usr/local/bin/python")
MAX_TIME_MS = int(os.environ.get("JUDGE_MAX_TIME_MS", "5000"))
MAX_MEMORY_MB = int(os.environ.get("JUDGE_MAX_MEMORY_MB", "512"))


def normalize_output(value: str) -> str:
    lines = value.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(line.rstrip() for line in lines)


def sandbox_limits(time_ms: int, memory_mb: int, output_limit: int):
    def apply() -> None:
        import resource
        os.setsid()
        resource.setrlimit(resource.RLIMIT_CPU, (max(1, math.ceil(time_ms / 1000)), max(2, math.ceil(time_ms / 1000) + 1)))
        memory = memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        resource.setrlimit(resource.RLIMIT_FSIZE, (output_limit, output_limit))
        resource.setrlimit(resource.RLIMIT_NPROC, (16, 16))
        resource.setrlimit(resource.RLIMIT_NOFILE, (32, 32))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        if os.getuid() == 0:
            os.setgroups([])
            os.setgid(65534)
            os.setuid(65534)
    return apply


def run_case(code: str, case: dict, kind: str, time_ms: int, memory_mb: int, output_limit: int) -> dict:
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="judge-") as folder:
        root = Path(folder)
        os.chmod(root, 0o755)
        source = root / "solution.py"
        source.write_text(code, encoding="utf-8")
        os.chmod(source, 0o444)
        stdout_path = root / "stdout.txt"
        stderr_path = root / "stderr.txt"
        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            child_env = {"PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"), "PYTHONIOENCODING": "utf-8", "LANG": "C.UTF-8"}
            if os.name != "posix":
                child_env = {**os.environ, **child_env}
            process_options = {
                "stdin": subprocess.PIPE, "stdout": stdout_file, "stderr": stderr_file, "cwd": root,
                "env": child_env,
            }
            if os.name == "posix":
                process_options["preexec_fn"] = sandbox_limits(time_ms, memory_mb, output_limit)
            process = subprocess.Popen([PYTHON, "-I", "-S", str(source)], **process_options)
            try:
                process.communicate(str(case.get("input", "")).encode("utf-8"), timeout=time_ms / 1000 + 0.25)
                timed_out = False
            except subprocess.TimeoutExpired:
                timed_out = True
                if os.name == "posix":
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                else:
                    process.kill()
                process.wait(timeout=1)
        stdout = stdout_path.read_bytes()[:output_limit].decode("utf-8", errors="replace")
        stderr = stderr_path.read_bytes()[:output_limit].decode("utf-8", errors="replace")
    duration_ms = max(1, round((time.monotonic() - started) * 1000))
    if timed_out:
        status = "TLE"
    elif process.returncode != 0:
        if any(name in stderr for name in ("SyntaxError", "IndentationError", "TabError")):
            status = "Syntax Error"
        elif "MemoryError" in stderr or (os.name == "posix" and process.returncode in {-signal.SIGKILL, -signal.SIGSEGV} and not stderr.strip()):
            status = "MLE"
        else:
            status = "RE"
    elif kind == "reference":
        status = "AC"
    else:
        status = "AC" if normalize_output(stdout) == normalize_output(str(case.get("expected", ""))) else "WA"
    return {
        "id": case.get("id"), "status": status, "duration_ms": duration_ms,
        "weight": int(case.get("weight") or 0), "stdout": stdout, "stderr": stderr,
    }


def execute(job: dict) -> dict:
    time_ms = max(100, min(MAX_TIME_MS, int(job.get("time_limit_ms") or 1000)))
    memory_mb = max(32, min(MAX_MEMORY_MB, int(job.get("memory_limit_mb") or 128)))
    output_limit = max(1024, min(1024 * 1024, int(job.get("output_limit_bytes") or 65536)))
    cases = [run_case(str(job.get("code", "")), case, str(job.get("kind", "submission")), time_ms, memory_mb, output_limit) for case in job.get("cases", [])]
    return {
        "job_id": job.get("job_id"), "kind": job.get("kind"), "status": "complete",
        "session_id": job.get("session_id"), "session_item_id": job.get("session_item_id"),
        "question_id": job.get("question_id"), "cases": cases,
    }


def process_file(path: Path) -> None:
    try:
        job = json.loads(path.read_text(encoding="utf-8"))
        result = execute(job)
    except Exception as exc:
        result = {"job_id": path.stem, "status": "failed", "error": str(exc)[:1000], "cases": []}
    temporary = OUTGOING / f".{path.stem}.tmp"
    target = OUTGOING / f"{path.stem}.json"
    temporary.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)
    path.unlink(missing_ok=True)


def main() -> None:
    INCOMING.mkdir(parents=True, exist_ok=True)
    OUTGOING.mkdir(parents=True, exist_ok=True)
    if os.name == "posix":
        shared_gid = grp.getgrnam("kidtype").gr_gid
        for folder in (QUEUE_ROOT, INCOMING, OUTGOING):
            os.chown(folder, 0, shared_gid)
            os.chmod(folder, 0o770)
    while True:
        files = sorted(INCOMING.glob("[0-9a-f]" * 32 + ".json"))
        if not files:
            time.sleep(0.2)
            continue
        process_file(files[0])


if __name__ == "__main__":
    main()
