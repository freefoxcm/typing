from __future__ import annotations

import copy
import hashlib
import io
import json
import re
import stat
import tempfile
import zipfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterable
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import Settings
from .exercise_library import question_dict, replace_question
from .exercise_schemas import QuestionWrite
from .models import Question, QuestionAsset, QuestionSet


BUNDLE_VERSION = 1
MAX_ARCHIVE_ENTRIES = 5000
MIGRATION_KEY_RE = re.compile(r"^[0-9a-f]{32}$")
ASSET_KINDS = {"source_pdf", "question", "question_stem"}
ASSET_MIME_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/webp"}


class BundleValidationError(ValueError):
    pass


class BundleConflictError(BundleValidationError):
    pass


@dataclass
class LoadedBundle:
    manifest: dict[str, Any]
    assets: dict[str, dict[str, Any]]
    asset_bytes: dict[str, bytes]


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _migration_key(value: Any, label: str) -> str:
    key = str(value or "").strip().lower()
    if not MIGRATION_KEY_RE.fullmatch(key):
        raise BundleValidationError(f"{label}的 migration_key 无效")
    return key


def _safe_storage_path(root: Path, storage_key: str) -> Path:
    root = root.resolve()
    path = (root / storage_key).resolve()
    if path.parent != root:
        raise BundleValidationError("题目资源路径不安全")
    return path


def _asset_extension(mime_type: str) -> str:
    return {
        "application/pdf": ".pdf",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(mime_type, ".png")


def _validate_asset_content(data: bytes, mime_type: str, settings: Settings, label: str) -> None:
    signatures = {
        "application/pdf": data.startswith(b"%PDF-"),
        "image/png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": data.startswith(b"\xff\xd8\xff"),
        "image/webp": len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP",
    }
    if not signatures.get(mime_type, False):
        raise BundleValidationError(f"{label}内容与声明的 MIME 类型不符")
    try:
        import pymupdf as fitz

        if mime_type == "application/pdf":
            document = fitz.open(stream=data, filetype="pdf")
            try:
                if document.page_count <= 0 or document.page_count > settings.import_max_pages:
                    raise BundleValidationError(f"{label}页数无效或超过 {settings.import_max_pages} 页")
            finally:
                document.close()
        else:
            pixmap = fitz.Pixmap(data)
            if pixmap.width <= 0 or pixmap.height <= 0 or pixmap.width * pixmap.height > 40_000_000:
                raise BundleValidationError(f"{label}图片尺寸无效或过大")
    except BundleValidationError:
        raise
    except Exception as exc:
        raise BundleValidationError(f"{label}内容损坏或与声明格式不符") from exc


def _question_payload(question: Question, asset_ref: Callable[[int | None, str], str | None]) -> dict[str, Any]:
    value = question_dict(question)
    for key in ("id", "question_set_id", "source_asset_id", "stem_image_asset_id"):
        value.pop(key, None)
    value["migration_key"] = question.migration_key
    value["source_asset_ref"] = asset_ref(question.source_asset_id, "question")
    value["stem_image_asset_ref"] = asset_ref(question.stem_image_asset_id, "question_stem")
    for option in value.get("options", []):
        option.pop("id", None)
    for blank in value.get("blanks", []):
        blank.pop("id", None)
    if value.get("programming"):
        for case in value["programming"].get("cases", []):
            case.pop("id", None)
    return value


def _fingerprint_payload(question_set: dict[str, Any], asset_sha: dict[str, str]) -> dict[str, Any]:
    value = copy.deepcopy(question_set)
    value.pop("fingerprint", None)
    value.pop("source_status", None)
    source_ref = value.pop("source_pdf_ref", None)
    value["source_pdf_sha256"] = asset_sha.get(source_ref, "") if source_ref else ""
    for question in value.get("questions", []):
        for ref_key, sha_key in (
            ("source_asset_ref", "source_asset_sha256"),
            ("stem_image_asset_ref", "stem_image_asset_sha256"),
        ):
            ref = question.pop(ref_key, None)
            question[sha_key] = asset_sha.get(ref, "") if ref else ""
    return value


def set_fingerprint(question_set: dict[str, Any], asset_sha: dict[str, str]) -> str:
    return hashlib.sha256(_canonical_json(_fingerprint_payload(question_set, asset_sha))).hexdigest()


def _serialize_sets(question_sets: Iterable[QuestionSet], settings: Settings) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, bytes]]:
    root = Path(settings.question_asset_dir).resolve()
    assets: dict[str, dict[str, Any]] = {}
    asset_bytes: dict[str, bytes] = {}
    asset_refs_by_id: dict[int, str] = {}

    def register(asset_id: int | None, expected_kind: str) -> str | None:
        if asset_id is None:
            return None
        asset = db_assets.get(asset_id)
        if not asset:
            raise BundleValidationError(f"题目引用的资源 #{asset_id} 不存在")
        if asset.kind != expected_kind or asset.mime_type not in ASSET_MIME_TYPES:
            raise BundleValidationError(f"资源类型不匹配：{asset.original_name or asset.storage_key}")
        if asset_id in asset_refs_by_id:
            return asset_refs_by_id[asset_id]
        path = _safe_storage_path(root, asset.storage_key)
        if not path.is_file():
            raise BundleValidationError(f"资源文件缺失：{asset.original_name or asset.storage_key}")
        data = path.read_bytes()
        if len(data) != asset.size_bytes:
            raise BundleValidationError(f"资源大小不一致：{asset.original_name or asset.storage_key}")
        _validate_asset_content(data, asset.mime_type, settings, asset.original_name or asset.storage_key)
        sha256 = hashlib.sha256(data).hexdigest()
        ref = f"asset-{len(assets) + 1}"
        archive_path = f"assets/{ref}{_asset_extension(asset.mime_type)}"
        assets[ref] = {
            "path": archive_path,
            "sha256": sha256,
            "size_bytes": len(data),
            "mime_type": asset.mime_type,
            "kind": asset.kind,
            "original_name": asset.original_name,
        }
        asset_bytes[ref] = data
        asset_refs_by_id[asset_id] = ref
        return ref

    items = list(question_sets)
    referenced_ids = {
        asset_id
        for item in items
        for asset_id in [item.source_pdf_asset_id]
        + [value for question in item.questions for value in (question.source_asset_id, question.stem_image_asset_id)]
        if asset_id is not None
    }
    db_assets = {
        asset.id: asset
        for asset in Session.object_session(items[0]).scalars(select(QuestionAsset).where(QuestionAsset.id.in_(referenced_ids))).all()
    } if items and referenced_ids else {}

    serialized: list[dict[str, Any]] = []
    for item in items:
        payload = {
            "migration_key": item.migration_key,
            "title": item.title,
            "description": item.description,
            "source_status": item.status,
            "source_pdf_ref": register(item.source_pdf_asset_id, "source_pdf"),
            "questions": [_question_payload(question, register) for question in item.questions],
        }
        payload["fingerprint"] = set_fingerprint(payload, {key: value["sha256"] for key, value in assets.items()})
        serialized.append(payload)
    return serialized, assets, asset_bytes


def create_bundle_file(question_sets: list[QuestionSet], settings: Settings) -> tuple[Path, str]:
    serialized, assets, asset_bytes = _serialize_sets(question_sets, settings)
    if len(assets) + 1 > MAX_ARCHIVE_ENTRIES:
        raise BundleValidationError("题套引用的资源文件过多，无法生成迁移包")
    manifest = {
        "version": BUNDLE_VERSION,
        "bundle_id": uuid4().hex,
        "created_at": datetime.utcnow().isoformat() + "Z",
        "question_sets": serialized,
        "assets": assets,
    }
    handle = tempfile.NamedTemporaryFile(prefix="question-set-bundle-", suffix=".zip", delete=False)
    path = Path(handle.name)
    handle.close()
    try:
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            for ref, metadata in assets.items():
                archive.writestr(metadata["path"], asset_bytes[ref])
        if path.stat().st_size > settings.question_bundle_max_mb * 1024 * 1024:
            raise BundleValidationError(f"生成的迁移包超过 {settings.question_bundle_max_mb} MB")
        filename = f"question-sets-{len(serialized)}sets-{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}.zip"
        return path, filename
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _validate_archive_path(name: str) -> None:
    if not name or "\\" in name:
        raise BundleValidationError("迁移包包含不安全的文件路径")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise BundleValidationError("迁移包包含路径穿越文件")


def _validate_question(raw: Any, set_label: str, index: int, assets: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise BundleValidationError(f"{set_label}第 {index + 1} 题不是对象")
    value = dict(raw)
    value["migration_key"] = _migration_key(value.get("migration_key"), f"{set_label}第 {index + 1} 题")
    for ref_key, expected_kind in (("source_asset_ref", "question"), ("stem_image_asset_ref", "question_stem")):
        ref = value.get(ref_key)
        if ref is not None:
            if ref not in assets:
                raise BundleValidationError(f"{set_label}第 {index + 1} 题引用了不存在的资源")
            if assets[ref]["kind"] != expected_kind:
                raise BundleValidationError(f"{set_label}第 {index + 1} 题资源类型不匹配")
    write_value = {key: item for key, item in value.items() if key not in {"migration_key", "source_asset_ref", "stem_image_asset_ref"}}
    write_value["source_asset_id"] = None
    write_value["stem_image_asset_id"] = None
    try:
        validated = QuestionWrite.model_validate(write_value)
    except Exception as exc:
        raise BundleValidationError(f"{set_label}第 {index + 1} 题内容无效：{exc}") from exc
    normalized = validated.model_dump()
    normalized.pop("source_asset_id", None)
    normalized.pop("stem_image_asset_id", None)
    normalized.update({
        "migration_key": value["migration_key"],
        "source_asset_ref": value.get("source_asset_ref"),
        "stem_image_asset_ref": value.get("stem_image_asset_ref"),
    })
    return normalized


def load_bundle(data: bytes, settings: Settings) -> LoadedBundle:
    compressed_limit = settings.question_bundle_max_mb * 1024 * 1024
    if not data or len(data) > compressed_limit:
        raise BundleValidationError(f"迁移包不能为空且不能超过 {settings.question_bundle_max_mb} MB")
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise BundleValidationError("文件不是有效的 ZIP 迁移包") from exc
    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > MAX_ARCHIVE_ENTRIES:
            raise BundleValidationError("迁移包文件数量无效或过多")
        names: set[str] = set()
        extracted_limit = compressed_limit * 4
        total_size = 0
        for entry in entries:
            _validate_archive_path(entry.filename)
            if entry.filename in names:
                raise BundleValidationError("迁移包包含重复文件路径")
            names.add(entry.filename)
            if entry.flag_bits & 0x1:
                raise BundleValidationError("不支持加密 ZIP")
            mode = entry.external_attr >> 16
            if stat.S_ISLNK(mode):
                raise BundleValidationError("迁移包不能包含符号链接")
            total_size += entry.file_size
            if total_size > extracted_limit:
                raise BundleValidationError("迁移包解压后内容过大")
        if "manifest.json" not in names:
            raise BundleValidationError("迁移包缺少 manifest.json")
        try:
            manifest = json.loads(archive.read("manifest.json"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise BundleValidationError("manifest.json 不是有效 JSON") from exc
        if not isinstance(manifest, dict) or manifest.get("version") != BUNDLE_VERSION:
            raise BundleValidationError("不支持的迁移包格式版本")
        _migration_key(manifest.get("bundle_id"), "迁移包")
        raw_assets = manifest.get("assets")
        if not isinstance(raw_assets, dict):
            raise BundleValidationError("迁移包 assets 必须是对象")
        assets: dict[str, dict[str, Any]] = {}
        asset_bytes: dict[str, bytes] = {}
        expected_files = {"manifest.json"}
        for ref, raw in raw_assets.items():
            if not isinstance(ref, str) or not ref or not isinstance(raw, dict):
                raise BundleValidationError("迁移包资源描述无效")
            path = str(raw.get("path") or "")
            _validate_archive_path(path)
            if not path.startswith("assets/") or path not in names:
                raise BundleValidationError(f"迁移包资源文件缺失：{path}")
            mime_type = str(raw.get("mime_type") or "")
            kind = str(raw.get("kind") or "")
            if mime_type not in ASSET_MIME_TYPES or kind not in ASSET_KINDS:
                raise BundleValidationError(f"迁移包资源类型无效：{path}")
            content = archive.read(path)
            size_bytes = int(raw.get("size_bytes") or -1)
            sha256 = str(raw.get("sha256") or "").lower()
            if len(content) != size_bytes or hashlib.sha256(content).hexdigest() != sha256:
                raise BundleValidationError(f"迁移包资源校验失败：{path}")
            _validate_asset_content(content, mime_type, settings, path)
            metadata = {
                "path": path,
                "sha256": sha256,
                "size_bytes": size_bytes,
                "mime_type": mime_type,
                "kind": kind,
                "original_name": str(raw.get("original_name") or Path(path).name)[:255],
            }
            assets[ref] = metadata
            asset_bytes[ref] = content
            expected_files.add(path)
        if names != expected_files:
            raise BundleValidationError("迁移包包含 manifest 未声明的文件")

    raw_sets = manifest.get("question_sets")
    if not isinstance(raw_sets, list) or not raw_sets or len(raw_sets) > 50:
        raise BundleValidationError("迁移包必须包含 1 到 50 个题套")
    normalized_sets: list[dict[str, Any]] = []
    set_keys: set[str] = set()
    question_keys: set[str] = set()
    asset_sha = {key: value["sha256"] for key, value in assets.items()}
    for set_index, raw in enumerate(raw_sets):
        if not isinstance(raw, dict):
            raise BundleValidationError(f"第 {set_index + 1} 个题套不是对象")
        key = _migration_key(raw.get("migration_key"), f"第 {set_index + 1} 个题套")
        if key in set_keys:
            raise BundleValidationError("迁移包包含重复题套标识")
        set_keys.add(key)
        title = str(raw.get("title") or "").strip()
        if not title or len(title) > 180:
            raise BundleValidationError(f"第 {set_index + 1} 个题套名称无效")
        source_pdf_ref = raw.get("source_pdf_ref")
        if source_pdf_ref is not None and (source_pdf_ref not in assets or assets[source_pdf_ref]["kind"] != "source_pdf"):
            raise BundleValidationError(f"题套《{title}》的原始 PDF 引用无效")
        raw_questions = raw.get("questions")
        if not isinstance(raw_questions, list) or len(raw_questions) > 10000:
            raise BundleValidationError(f"题套《{title}》的题目列表无效或过多")
        questions = [_validate_question(question, f"题套《{title}》", index, assets) for index, question in enumerate(raw_questions)]
        for question in questions:
            if question["migration_key"] in question_keys:
                raise BundleValidationError("迁移包包含重复题目标识")
            question_keys.add(question["migration_key"])
        normalized = {
            "migration_key": key,
            "title": title,
            "description": str(raw.get("description") or "")[:5000],
            "source_status": str(raw.get("source_status") or "draft"),
            "source_pdf_ref": source_pdf_ref,
            "questions": questions,
        }
        expected_fingerprint = str(raw.get("fingerprint") or "")
        actual_fingerprint = set_fingerprint(normalized, asset_sha)
        if expected_fingerprint != actual_fingerprint:
            raise BundleValidationError(f"题套《{title}》内容指纹校验失败")
        normalized["fingerprint"] = actual_fingerprint
        normalized_sets.append(normalized)
    manifest = dict(manifest)
    manifest["question_sets"] = normalized_sets
    manifest["assets"] = assets
    return LoadedBundle(manifest=manifest, assets=assets, asset_bytes=asset_bytes)


def _current_set_fingerprint(question_set: QuestionSet, settings: Settings) -> str:
    serialized, assets, _ = _serialize_sets([question_set], settings)
    return set_fingerprint(serialized[0], {key: value["sha256"] for key, value in assets.items()})


def _set_counts(raw_set: dict[str, Any]) -> tuple[dict[str, int], int]:
    counts = {kind: 0 for kind in ("single_choice", "multiple_choice", "true_false", "fill_blank", "programming")}
    programming_cases = 0
    for question in raw_set["questions"]:
        counts[question["type"]] += 1
        if question.get("programming"):
            programming_cases += len(question["programming"].get("cases", []))
    return counts, programming_cases


def preview_bundle(db: Session, settings: Settings, bundle: LoadedBundle) -> dict[str, Any]:
    result_sets: list[dict[str, Any]] = []
    for raw_set in bundle.manifest["question_sets"]:
        target = db.scalar(select(QuestionSet).where(QuestionSet.migration_key == raw_set["migration_key"]))
        target_fingerprint = _current_set_fingerprint(target, settings) if target else None
        if not target:
            conflict = "none"
            default_action = "create"
            allowed_actions = ["create", "skip"]
        else:
            conflict = "same_origin_unchanged" if target_fingerprint == raw_set["fingerprint"] else "same_origin_changed"
            default_action = "skip" if conflict == "same_origin_unchanged" else "copy"
            allowed_actions = ["skip", "copy"] + (["overwrite"] if target.status == "draft" else [])
        refs = {
            ref
            for question in raw_set["questions"]
            for ref in (question.get("source_asset_ref"), question.get("stem_image_asset_ref"))
            if ref
        }
        if raw_set.get("source_pdf_ref"):
            refs.add(raw_set["source_pdf_ref"])
        counts, programming_cases = _set_counts(raw_set)
        warnings = []
        if not raw_set.get("source_pdf_ref"):
            warnings.append("源题套没有关联原始 PDF，导入后无法进行整套重新识别")
        if target and target.status != "draft":
            warnings.append("同源题套不是草稿，不能覆盖；请先在目标服务器撤回或解除归档")
        result_sets.append({
            "migration_key": raw_set["migration_key"],
            "title": raw_set["title"],
            "source_status": raw_set["source_status"],
            "fingerprint": raw_set["fingerprint"],
            "question_count": len(raw_set["questions"]),
            "counts": counts,
            "asset_count": len(refs),
            "programming_case_count": programming_cases,
            "has_source_pdf": bool(raw_set.get("source_pdf_ref")),
            "conflict": conflict,
            "default_action": default_action,
            "allowed_actions": allowed_actions,
            "target": {
                "id": target.id,
                "title": target.title,
                "status": target.status,
                "fingerprint": target_fingerprint,
            } if target else None,
            "warnings": warnings,
        })
    return {
        "valid": True,
        "version": bundle.manifest["version"],
        "bundle_id": bundle.manifest["bundle_id"],
        "created_at": bundle.manifest.get("created_at"),
        "question_set_count": len(result_sets),
        "question_count": sum(item["question_count"] for item in result_sets),
        "asset_count": len(bundle.assets),
        "question_sets": result_sets,
        "errors": [],
    }


def _write_value(raw: dict[str, Any], asset_ids: dict[str, int]) -> QuestionWrite:
    value = {key: copy.deepcopy(item) for key, item in raw.items() if key not in {"migration_key", "source_asset_ref", "stem_image_asset_ref"}}
    value["source_asset_id"] = asset_ids.get(raw.get("source_asset_ref"))
    value["stem_image_asset_id"] = asset_ids.get(raw.get("stem_image_asset_ref"))
    return QuestionWrite.model_validate(value)


def _materialize_assets(
    db: Session,
    settings: Settings,
    bundle: LoadedBundle,
    raw_set: dict[str, Any],
    question_set_id: int,
    created_paths: list[Path],
) -> dict[str, int]:
    refs = {
        ref
        for question in raw_set["questions"]
        for ref in (question.get("source_asset_ref"), question.get("stem_image_asset_ref"))
        if ref
    }
    if raw_set.get("source_pdf_ref"):
        refs.add(raw_set["source_pdf_ref"])
    root = Path(settings.question_asset_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    result: dict[str, int] = {}
    for ref in sorted(refs):
        metadata = bundle.assets[ref]
        storage_key = f"bundle-{question_set_id}-{uuid4().hex}{_asset_extension(metadata['mime_type'])}"
        path = _safe_storage_path(root, storage_key)
        path.write_bytes(bundle.asset_bytes[ref])
        created_paths.append(path)
        asset = QuestionAsset(
            question_set_id=question_set_id,
            storage_key=storage_key,
            original_name=metadata["original_name"],
            mime_type=metadata["mime_type"],
            kind=metadata["kind"],
            size_bytes=metadata["size_bytes"],
        )
        db.add(asset)
        db.flush()
        result[ref] = asset.id
    return result


def _apply_set(
    db: Session,
    settings: Settings,
    bundle: LoadedBundle,
    raw_set: dict[str, Any],
    action: str,
    target: QuestionSet | None,
    next_sort_order: int,
    created_paths: list[Path],
) -> QuestionSet:
    copying = action == "copy"
    if action == "overwrite":
        if not target or target.status != "draft":
            raise BundleValidationError("只能覆盖同源草稿题套")
        question_set = target
        question_set.title = raw_set["title"]
        question_set.description = raw_set["description"]
        question_set.status = "draft"
        question_set.published_at = None
    else:
        question_set = QuestionSet(
            migration_key=uuid4().hex if copying else raw_set["migration_key"],
            title=raw_set["title"],
            description=raw_set["description"],
            status="draft",
            sort_order=next_sort_order,
        )
        db.add(question_set)
        db.flush()

    asset_ids = _materialize_assets(db, settings, bundle, raw_set, question_set.id, created_paths)
    question_set.source_pdf_asset_id = asset_ids.get(raw_set.get("source_pdf_ref"))
    existing = {question.migration_key: question for question in list(question_set.questions)} if action == "overwrite" else {}
    retained: set[int] = set()
    for sort_order, raw_question in enumerate(raw_set["questions"]):
        item = existing.get(raw_question["migration_key"])
        if item is None:
            item = Question(
                question_set_id=question_set.id,
                migration_key=uuid4().hex if copying else raw_question["migration_key"],
                type=raw_question["type"],
                stem_markdown=raw_question["stem_markdown"],
            )
            db.add(item)
        replace_question(item, _write_value(raw_question, asset_ids))
        item.sort_order = sort_order
        db.flush()
        retained.add(item.id)
    if action == "overwrite":
        for old_question in list(question_set.questions):
            if old_question.id not in retained:
                db.delete(old_question)
    return question_set


def import_bundle(
    db: Session,
    settings: Settings,
    bundle: LoadedBundle,
    decisions: list[dict[str, Any]],
) -> dict[str, Any]:
    by_key = {item["migration_key"]: item for item in bundle.manifest["question_sets"]}
    decision_by_key: dict[str, dict[str, Any]] = {}
    for decision in decisions:
        if not isinstance(decision, dict):
            raise BundleValidationError("导入处理规则无效")
        key = str(decision.get("migration_key") or "")
        action = str(decision.get("action") or "")
        if key not in by_key or key in decision_by_key or action not in {"create", "skip", "copy", "overwrite"}:
            raise BundleValidationError("导入处理规则包含未知题套、重复题套或无效操作")
        decision_by_key[key] = decision
    if set(decision_by_key) != set(by_key):
        raise BundleValidationError("必须为迁移包中的每个题套选择处理规则")

    preview = preview_bundle(db, settings, bundle)
    preview_by_key = {item["migration_key"]: item for item in preview["question_sets"]}
    for key, decision in decision_by_key.items():
        item = preview_by_key[key]
        action = decision["action"]
        target = item["target"]
        expected_target_id = decision.get("target_set_id")
        expected_target_id = int(expected_target_id) if expected_target_id is not None else None
        expected_target_fingerprint = decision.get("expected_target_fingerprint")
        if (target["id"] if target else None) != expected_target_id or (target["fingerprint"] if target else None) != expected_target_fingerprint:
            raise BundleConflictError(f"题套《{item['title']}》在预览后已变化，请重新预览")
        if action not in item["allowed_actions"]:
            raise BundleConflictError(f"题套《{item['title']}》当前不能执行 {action}")
        if action == "overwrite":
            if not target:
                raise BundleConflictError(f"题套《{item['title']}》覆盖目标已变化")

    created_paths: list[Path] = []
    result = {"created": [], "copied": [], "overwritten": [], "skipped": []}
    try:
        max_order = db.scalar(select(func.max(QuestionSet.sort_order)))
        next_order = 0 if max_order is None else max_order + 1
        for raw_set in bundle.manifest["question_sets"]:
            decision = decision_by_key[raw_set["migration_key"]]
            action = decision["action"]
            if action == "skip":
                result["skipped"].append({"migration_key": raw_set["migration_key"], "title": raw_set["title"]})
                continue
            target = db.scalar(select(QuestionSet).where(QuestionSet.migration_key == raw_set["migration_key"]))
            if action == "create" and target:
                raise BundleValidationError(f"题套《{raw_set['title']}》已存在，不能新建")
            if action in {"create", "overwrite"}:
                package_question_keys = {question["migration_key"] for question in raw_set["questions"]}
                conflicts = db.scalars(select(Question).where(Question.migration_key.in_(package_question_keys))).all()
                if action == "create" and conflicts:
                    raise BundleValidationError(f"题套《{raw_set['title']}》包含已存在的题目标识")
                if action == "overwrite" and any(question.question_set_id != target.id for question in conflicts):
                    raise BundleValidationError(f"题套《{raw_set['title']}》的题目标识与其他题套冲突")
            question_set = _apply_set(db, settings, bundle, raw_set, action, target, next_order, created_paths)
            if action != "overwrite":
                next_order += 1
            bucket = "copied" if action == "copy" else "overwritten" if action == "overwrite" else "created"
            result[bucket].append({"id": question_set.id, "title": question_set.title})
        db.commit()
    except Exception:
        db.rollback()
        for path in created_paths:
            path.unlink(missing_ok=True)
        raise
    return {"ok": True, **result}
