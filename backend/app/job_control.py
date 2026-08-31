import asyncio
from datetime import datetime, timezone
from threading import Lock
from typing import Any


_active_jobs: dict[tuple[str, int], tuple[asyncio.AbstractEventLoop, asyncio.Task[Any]]] = {}
_active_jobs_lock = Lock()


def progress_payload(
    phase: str,
    label: str,
    percent: int,
    *,
    current: int | None = None,
    total: int | None = None,
    unit: str | None = None,
    detail: str = "",
) -> dict[str, Any]:
    return {
        "phase": phase,
        "label": label,
        "percent": max(0, min(100, int(percent))),
        "current": current,
        "total": total,
        "unit": unit,
        "detail": detail,
        "updated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def register_active_job(kind: str, job_id: int, task: asyncio.Task[Any]) -> None:
    with _active_jobs_lock:
        _active_jobs[(kind, job_id)] = (asyncio.get_running_loop(), task)


def unregister_active_job(kind: str, job_id: int, task: asyncio.Task[Any]) -> None:
    with _active_jobs_lock:
        current = _active_jobs.get((kind, job_id))
        if current and current[1] is task:
            _active_jobs.pop((kind, job_id), None)


def cancel_active_job(kind: str, job_id: int) -> bool:
    with _active_jobs_lock:
        current = _active_jobs.get((kind, job_id))
    if not current:
        return False
    loop, task = current
    if task.done():
        return False
    try:
        loop.call_soon_threadsafe(task.cancel)
    except RuntimeError:
        return False
    return True
