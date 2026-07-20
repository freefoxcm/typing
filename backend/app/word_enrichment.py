import asyncio
import json
from datetime import datetime, timedelta
from typing import Callable

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from .config import Settings
from .models import Word


def llm_configured(settings: Settings) -> bool:
    return bool(settings.llm_api_key.strip() and settings.llm_model.strip() and settings.llm_base_url.strip())


def mark_word_readiness(word: Word, reset_attempts: bool = True) -> None:
    # SQLAlchemy column defaults are applied when an object is flushed. A newly
    # constructed Word can therefore still contain None while bulk import is
    # deciding whether it should enter the enrichment queue.
    word.phonetic = (word.phonetic or "").strip()
    word.meaning_zh = (word.meaning_zh or "").strip()
    word.technical_meaning_zh = (word.technical_meaning_zh or "").strip()
    ready = bool(word.phonetic and word.meaning_zh)
    word.enrichment_status = "ready" if ready else "pending"
    word.enrichment_error = ""
    word.next_retry_at = None
    word.processing_started_at = None
    if reset_attempts:
        word.enrichment_attempts = 0


def parse_llm_content(content: str) -> dict[str, str]:
    text = content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1]
        text = text.rsplit("```", 1)[0].strip()
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        raise ValueError("模型未返回 JSON 对象")
    payload = json.loads(text[start:end + 1])
    values = {
        "phonetic": str(payload.get("phonetic", "")).strip(),
        "meaning_zh": str(payload.get("meaning_zh", "")).strip(),
        "technical_meaning_zh": str(payload.get("technical_meaning_zh", "")).strip(),
    }
    if not values["phonetic"] or not values["meaning_zh"]:
        raise ValueError("模型返回的音标或常用释义为空")
    if len(values["phonetic"]) > 160 or any(len(values[key]) > 2000 for key in ("meaning_zh", "technical_meaning_zh")):
        raise ValueError("模型返回内容过长")
    return values


async def request_enrichment(settings: Settings, spelling: str) -> dict[str, str]:
    prompt = (
        "请为儿童英语打字词库补全词条。只返回一个 JSON 对象，不要 Markdown。"
        "字段必须是 phonetic（美式 IPA，包含斜杠）、meaning_zh（简洁常用中文释义）、"
        "technical_meaning_zh（计算机领域专有释义；确实没有时为空字符串）。"
        f"词条：{spelling}"
    )
    async with httpx.AsyncClient(timeout=settings.llm_timeout_seconds) as client:
        response = await client.post(
            f"{settings.llm_base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"},
            json={
                "model": settings.llm_model,
                "temperature": 0.1,
                "messages": [
                    {"role": "system", "content": "你是严谨的英汉词典编辑，必须输出合法 JSON。"},
                    {"role": "user", "content": prompt},
                ],
            },
        )
        response.raise_for_status()
        body = response.json()
        return parse_llm_content(body["choices"][0]["message"]["content"])


def _claim_word(session_factory: Callable[[], Session]) -> tuple[int, str] | None:
    now = datetime.utcnow()
    stale = now - timedelta(minutes=5)
    with session_factory() as db:
        db.execute(update(Word).where(
            Word.enrichment_status == "processing",
            Word.processing_started_at < stale,
        ).values(enrichment_status="pending", processing_started_at=None))
        word = db.scalar(select(Word).where(
            Word.enrichment_status == "pending",
            or_(Word.next_retry_at.is_(None), Word.next_retry_at <= now),
        ).order_by(Word.next_retry_at, Word.id).limit(1))
        if not word:
            db.commit()
            return None
        word.enrichment_status = "processing"
        word.processing_started_at = now
        db.commit()
        return word.id, word.spelling


def _complete_word(session_factory: Callable[[], Session], word_id: int, values: dict[str, str]) -> None:
    with session_factory() as db:
        word = db.get(Word, word_id)
        if not word or word.enrichment_status != "processing":
            return
        if not word.phonetic.strip():
            word.phonetic = values["phonetic"]
        if not word.meaning_zh.strip():
            word.meaning_zh = values["meaning_zh"]
        if not word.technical_meaning_zh.strip():
            word.technical_meaning_zh = values["technical_meaning_zh"]
        mark_word_readiness(word, reset_attempts=False)
        db.commit()


def _fail_word(session_factory: Callable[[], Session], word_id: int, settings: Settings, exc: Exception) -> None:
    with session_factory() as db:
        word = db.get(Word, word_id)
        if not word or word.enrichment_status != "processing":
            return
        word.enrichment_attempts += 1
        word.enrichment_error = str(exc)[:1000]
        word.processing_started_at = None
        if word.enrichment_attempts >= settings.llm_max_retries:
            word.enrichment_status = "failed"
            word.next_retry_at = None
        else:
            word.enrichment_status = "pending"
            word.next_retry_at = datetime.utcnow() + timedelta(seconds=min(300, 2 ** word.enrichment_attempts))
        db.commit()


async def enrichment_worker(session_factory: Callable[[], Session], settings: Settings) -> None:
    while True:
        if not llm_configured(settings):
            await asyncio.sleep(5)
            continue
        claimed = _claim_word(session_factory)
        if not claimed:
            await asyncio.sleep(1)
            continue
        word_id, spelling = claimed
        try:
            values = await request_enrichment(settings, spelling)
            _complete_word(session_factory, word_id, values)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _fail_word(session_factory, word_id, settings, exc)
