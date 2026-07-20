from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from ..config import Settings, get_settings
from ..database import get_db
from ..models import Word, WordSet
from ..schemas import WordImportRequest, WordSetOrder, WordSetWrite, WordWrite
from ..security import require_admin
from ..word_enrichment import llm_configured, mark_word_readiness
from ..word_imports import clean_spelling, normalize_spelling, parse_word_import

router = APIRouter(prefix="/api/admin", tags=["admin-words"], dependencies=[Depends(require_admin)])


def _commit(db: Session, duplicate_message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=duplicate_message) from exc


def _word_dict(word: Word) -> dict:
    return {
        "id": word.id,
        "word_set_id": word.word_set_id,
        "spelling": word.spelling,
        "phonetic": word.phonetic,
        "meaning_zh": word.meaning_zh,
        "technical_meaning_zh": word.technical_meaning_zh,
        "active": word.active,
        "enrichment_status": word.enrichment_status,
        "enrichment_attempts": word.enrichment_attempts,
        "enrichment_error": word.enrichment_error,
        "updated_at": word.updated_at,
    }


def _word_set_dict(item: WordSet, include_words: bool = True) -> dict:
    counts = {status: 0 for status in ("ready", "pending", "processing", "failed")}
    for word in item.words:
        counts[word.enrichment_status] = counts.get(word.enrichment_status, 0) + 1
    result = {
        "id": item.id,
        "title": item.title,
        "description": item.description,
        "sort_order": item.sort_order,
        "active": item.active,
        "word_count": len(item.words),
        "status_counts": counts,
    }
    if include_words:
        result["words"] = [_word_dict(word) for word in item.words]
    return result


@router.get("/llm/status")
def llm_status(settings: Settings = Depends(get_settings)):
    return {
        "configured": llm_configured(settings),
        "base_url": settings.llm_base_url,
        "model": settings.llm_model,
    }


@router.get("/word-sets")
def list_word_sets(db: Session = Depends(get_db)):
    items = db.scalars(select(WordSet).options(selectinload(WordSet.words)).order_by(WordSet.sort_order, WordSet.id)).all()
    return [_word_set_dict(item) for item in items]


@router.post("/word-sets", status_code=201)
def create_word_set(payload: WordSetWrite, db: Session = Depends(get_db)):
    item = WordSet(**payload.model_dump())
    db.add(item)
    _commit(db, "单词集名称已存在")
    db.refresh(item)
    return _word_set_dict(item)


@router.put("/word-sets/order")
def reorder_word_sets(payload: WordSetOrder, db: Session = Depends(get_db)):
    items = db.scalars(select(WordSet)).all()
    by_id = {item.id: item for item in items}
    if set(payload.word_set_ids) != set(by_id):
        raise HTTPException(status_code=409, detail="单词集列表已变化，请刷新后重试")
    for order, item_id in enumerate(payload.word_set_ids):
        by_id[item_id].sort_order = order
    db.commit()
    return {"ok": True, "word_set_ids": payload.word_set_ids}


@router.put("/word-sets/{item_id}")
def update_word_set(item_id: int, payload: WordSetWrite, db: Session = Depends(get_db)):
    item = db.get(WordSet, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="单词集不存在")
    for key, value in payload.model_dump().items():
        setattr(item, key, value)
    _commit(db, "单词集名称已存在")
    return _word_set_dict(item)


@router.delete("/word-sets/{item_id}", status_code=204)
def delete_word_set(item_id: int, db: Session = Depends(get_db)):
    item = db.get(WordSet, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="单词集不存在")
    db.delete(item)
    db.commit()


def _apply_word_payload(word: Word, payload: WordWrite) -> None:
    word.word_set_id = payload.word_set_id
    word.spelling = clean_spelling(payload.spelling)
    word.normalized_spelling = normalize_spelling(word.spelling)
    word.phonetic = payload.phonetic.strip()
    word.meaning_zh = payload.meaning_zh.strip()
    word.technical_meaning_zh = payload.technical_meaning_zh.strip()
    word.active = payload.active
    mark_word_readiness(word)


@router.post("/words", status_code=201)
def create_word(payload: WordWrite, db: Session = Depends(get_db)):
    if not db.get(WordSet, payload.word_set_id):
        raise HTTPException(status_code=404, detail="单词集不存在")
    word = Word(word_set_id=payload.word_set_id, spelling="", normalized_spelling="")
    _apply_word_payload(word, payload)
    db.add(word)
    _commit(db, "该单词集内已存在相同词条")
    db.refresh(word)
    return _word_dict(word)


@router.put("/words/{word_id}")
def update_word(word_id: int, payload: WordWrite, db: Session = Depends(get_db)):
    word = db.get(Word, word_id)
    if not word:
        raise HTTPException(status_code=404, detail="单词不存在")
    if not db.get(WordSet, payload.word_set_id):
        raise HTTPException(status_code=404, detail="单词集不存在")
    _apply_word_payload(word, payload)
    _commit(db, "该单词集内已存在相同词条")
    return _word_dict(word)


@router.delete("/words/{word_id}", status_code=204)
def delete_word(word_id: int, db: Session = Depends(get_db)):
    word = db.get(Word, word_id)
    if not word:
        raise HTTPException(status_code=404, detail="单词不存在")
    db.delete(word)
    db.commit()


@router.post("/words/{word_id}/retry")
def retry_word(word_id: int, db: Session = Depends(get_db)):
    word = db.get(Word, word_id)
    if not word:
        raise HTTPException(status_code=404, detail="单词不存在")
    mark_word_readiness(word)
    db.commit()
    return _word_dict(word)


@router.post("/word-sets/{word_set_id}/retry-failed")
def retry_failed_words(word_set_id: int, db: Session = Depends(get_db)):
    if not db.get(WordSet, word_set_id):
        raise HTTPException(status_code=404, detail="单词集不存在")
    words = db.scalars(select(Word).where(Word.word_set_id == word_set_id, Word.enrichment_status == "failed")).all()
    for word in words:
        mark_word_readiness(word)
    db.commit()
    return {"ok": True, "retried": len(words)}


def _import_summary(payload: WordImportRequest, db: Session) -> tuple[dict, object]:
    if not db.get(WordSet, payload.word_set_id):
        raise HTTPException(status_code=404, detail="单词集不存在")
    parsed = parse_word_import(payload.format, payload.content)
    existing = {
        item.normalized_spelling: item
        for item in db.scalars(select(Word).where(Word.word_set_id == payload.word_set_id)).all()
    }
    if payload.mode == "replace":
        existing = {}
    created = updated = queued = 0
    for item in parsed.items:
        old = existing.get(normalize_spelling(item.spelling))
        created += old is None
        updated += old is not None
        phonetic = item.phonetic or (old.phonetic if old else "")
        meaning = item.meaning_zh or (old.meaning_zh if old else "")
        queued += not (phonetic.strip() and meaning.strip())
    return {**parsed.summary(), "created_count": created, "updated_count": updated, "queued_count": queued}, parsed


@router.post("/word-import/preview")
def preview_word_import(payload: WordImportRequest, db: Session = Depends(get_db)):
    summary, _ = _import_summary(payload, db)
    return summary


@router.post("/word-import")
def commit_word_import(payload: WordImportRequest, db: Session = Depends(get_db)):
    summary, parsed = _import_summary(payload, db)
    if parsed.errors:
        raise HTTPException(status_code=422, detail={"message": "导入内容有误", **summary})
    if payload.mode == "replace":
        db.execute(delete(Word).where(Word.word_set_id == payload.word_set_id))
        db.flush()
        existing: dict[str, Word] = {}
    else:
        existing = {
            item.normalized_spelling: item
            for item in db.scalars(select(Word).where(Word.word_set_id == payload.word_set_id)).all()
        }
    for item in parsed.items:
        key = normalize_spelling(item.spelling)
        word = existing.get(key)
        if not word:
            word = Word(word_set_id=payload.word_set_id, spelling=item.spelling, normalized_spelling=key)
            db.add(word)
            existing[key] = word
        word.spelling = item.spelling
        if item.phonetic:
            word.phonetic = item.phonetic
        if item.meaning_zh:
            word.meaning_zh = item.meaning_zh
        if item.technical_meaning_zh:
            word.technical_meaning_zh = item.technical_meaning_zh
        if item.active is not None:
            word.active = item.active
        elif word.id is None:
            word.active = True
        mark_word_readiness(word)
    _commit(db, "导入内容包含重复词条")
    return {"ok": True, **summary}


@router.get("/word-export")
def export_word_library(db: Session = Depends(get_db)):
    sets = db.scalars(select(WordSet).options(selectinload(WordSet.words)).order_by(WordSet.sort_order, WordSet.id)).all()
    payload = {
        "version": 1,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "word_sets": [{
            "title": item.title,
            "description": item.description,
            "sort_order": item.sort_order,
            "active": item.active,
            "words": [{
                "word": word.spelling,
                "phonetic": word.phonetic,
                "meaning_zh": word.meaning_zh,
                "technical_meaning_zh": word.technical_meaning_zh,
                "active": word.active,
            } for word in item.words],
        } for item in sets],
    }
    return JSONResponse(payload, headers={"Content-Disposition": "attachment; filename=kidtype-words.json"})
