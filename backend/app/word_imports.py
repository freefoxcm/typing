import csv
import io
import json
from dataclasses import dataclass, field
from typing import Any


def normalize_spelling(value: str) -> str:
    return " ".join(value.strip().split()).casefold()


def clean_spelling(value: str) -> str:
    return " ".join(value.strip().split())


def validate_spelling(value: str) -> str | None:
    if not value:
        return "单词或术语不能为空"
    if len(value) > 120:
        return "单词或术语不能超过 120 个字符"
    if any(ord(char) < 32 or ord(char) > 126 for char in value):
        return "只能包含可打印 ASCII 字符"
    return None


def _optional_bool(value: Any) -> bool | None:
    if value is None or str(value).strip() == "":
        return None
    return str(value).strip().lower() not in {"0", "false", "no", "off", "停用"}


@dataclass
class WordImportItem:
    spelling: str
    phonetic: str = ""
    meaning_zh: str = ""
    technical_meaning_zh: str = ""
    active: bool | None = None


@dataclass
class WordImportResult:
    items: list[WordImportItem] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {"valid": not self.errors, "word_count": len(self.items), "errors": self.errors[:100]}


def parse_word_import(format_name: str, content: str) -> WordImportResult:
    result = WordImportResult()
    raw_items: list[WordImportItem] = []
    try:
        if format_name == "txt":
            raw_items = [WordImportItem(clean_spelling(line)) for line in content.splitlines() if line.strip()]
        elif format_name == "csv":
            reader = csv.DictReader(io.StringIO(content))
            if not reader.fieldnames or "word" not in reader.fieldnames:
                return WordImportResult(errors=["CSV 必须包含 word 列"])
            for row in reader:
                raw_items.append(WordImportItem(
                    spelling=clean_spelling(row.get("word") or ""),
                    phonetic=(row.get("phonetic") or "").strip(),
                    meaning_zh=(row.get("meaning_zh") or "").strip(),
                    technical_meaning_zh=(row.get("technical_meaning_zh") or "").strip(),
                    active=_optional_bool(row.get("active")),
                ))
        elif format_name == "json":
            payload = json.loads(content)
            words = payload.get("words") if isinstance(payload, dict) else None
            if not isinstance(words, list):
                return WordImportResult(errors=["JSON 根对象必须包含 words 数组"])
            for item in words:
                if isinstance(item, str):
                    item = {"word": item}
                if not isinstance(item, dict):
                    raw_items.append(WordImportItem(""))
                    continue
                raw_items.append(WordImportItem(
                    spelling=clean_spelling(str(item.get("word", ""))),
                    phonetic=str(item.get("phonetic", "")).strip(),
                    meaning_zh=str(item.get("meaning_zh", "")).strip(),
                    technical_meaning_zh=str(item.get("technical_meaning_zh", "")).strip(),
                    active=_optional_bool(item.get("active")),
                ))
        else:
            return WordImportResult(errors=["仅支持 txt、csv、json 格式"])
    except (csv.Error, json.JSONDecodeError, TypeError, ValueError) as exc:
        return WordImportResult(errors=[f"文件解析失败：{exc}"])

    merged: dict[str, WordImportItem] = {}
    for index, item in enumerate(raw_items, start=1):
        error = validate_spelling(item.spelling)
        if error:
            result.errors.append(f"第 {index} 条：{error}")
            continue
        for label, value, limit in (
            ("音标", item.phonetic, 160),
            ("常用中文释义", item.meaning_zh, 2000),
            ("计算机领域释义", item.technical_meaning_zh, 2000),
        ):
            if len(value) > limit:
                result.errors.append(f"第 {index} 条：{label}不能超过 {limit} 个字符")
        key = normalize_spelling(item.spelling)
        existing = merged.get(key)
        if not existing:
            merged[key] = item
            continue
        existing.spelling = item.spelling
        if item.phonetic:
            existing.phonetic = item.phonetic
        if item.meaning_zh:
            existing.meaning_zh = item.meaning_zh
        if item.technical_meaning_zh:
            existing.technical_meaning_zh = item.technical_meaning_zh
        if item.active is not None:
            existing.active = item.active
    result.items = list(merged.values())
    if not result.items and not result.errors:
        result.errors.append("没有找到可导入的单词")
    return result
