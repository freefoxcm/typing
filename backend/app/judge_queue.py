import json
import os
import uuid
from pathlib import Path
from typing import Any

from .config import Settings


def _folders(settings: Settings) -> tuple[Path, Path]:
    root = Path(settings.judge_queue_dir)
    incoming = root / "incoming"
    outgoing = root / "outgoing"
    incoming.mkdir(parents=True, exist_ok=True)
    outgoing.mkdir(parents=True, exist_ok=True)
    return incoming, outgoing


def enqueue(settings: Settings, payload: dict[str, Any]) -> str:
    incoming, _ = _folders(settings)
    job_id = uuid.uuid4().hex
    payload = {**payload, "job_id": job_id, "output_limit_bytes": settings.judge_output_limit_bytes}
    temporary = incoming / f".{job_id}.tmp"
    target = incoming / f"{job_id}.json"
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, target)
    return job_id


def result(settings: Settings, job_id: str, consume: bool = False) -> dict[str, Any] | None:
    if not job_id or any(char not in "0123456789abcdef" for char in job_id) or len(job_id) != 32:
        return None
    _, outgoing = _folders(settings)
    path = outgoing / f"{job_id}.json"
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if consume:
        path.unlink(missing_ok=True)
    return payload if isinstance(payload, dict) else None
