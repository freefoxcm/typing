from collections.abc import Iterable

from .models import PracticeAttempt


CURRENT_METRIC_VERSION = 2
LEGACY_METRIC_VERSION = 1


def calculate_cpm(speed_char_count: int, duration_ms: int) -> int | None:
    if speed_char_count <= 0:
        return None
    numerator = speed_char_count * 60_000
    return (numerator * 2 + duration_ms) // (duration_ms * 2)


def preferred_speed_attempts(attempts: Iterable[PracticeAttempt]) -> tuple[list[PracticeAttempt], int | None]:
    measurable = [
        item for item in attempts
        if item.cpm is not None and item.speed_char_count > 0
    ]
    current = [item for item in measurable if item.metric_version == CURRENT_METRIC_VERSION]
    selected = current or [item for item in measurable if item.metric_version == LEGACY_METRIC_VERSION]
    if not selected:
        return [], None
    return selected, CURRENT_METRIC_VERSION if current else LEGACY_METRIC_VERSION


def preferred_speed_metrics(attempts: Iterable[PracticeAttempt]) -> tuple[int | None, int | None, int]:
    selected, version = preferred_speed_attempts(attempts)
    if not selected:
        return None, None, 0
    total_duration = sum(item.duration_ms for item in selected)
    total_speed_chars = sum(item.speed_char_count for item in selected)
    return calculate_cpm(total_speed_chars, total_duration), version, len(selected)
