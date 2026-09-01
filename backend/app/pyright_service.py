import asyncio
import hashlib
import json
import logging
import secrets
import tempfile
import time
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings


logger = logging.getLogger(__name__)
DOCUMENT_IDLE_SECONDS = 30 * 60


@dataclass
class OpenDocument:
    uri: str
    version: int
    code_hash: str
    last_used: float


@dataclass
class CachedCompletion:
    child_id: int
    session_id: int
    session_item_id: int
    document_uri: str
    document_version: int
    item: dict[str, Any]
    created_at: float


COMPLETION_KIND = {
    2: "method",
    3: "function",
    4: "constructor",
    5: "property",
    6: "variable",
    7: "class",
    8: "interface",
    9: "namespace",
    10: "property",
    11: "unit",
    12: "value",
    13: "enum",
    14: "keyword",
    15: "snippet",
    17: "file",
    21: "constant",
    22: "struct",
    23: "event",
    25: "operator",
}


def _documentation_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict) and isinstance(value.get("value"), str):
        return value["value"]
    return ""


def _completion_range(item: dict[str, Any]) -> dict[str, Any] | None:
    edit = item.get("textEdit")
    if not isinstance(edit, dict):
        return None
    value = edit.get("range") or edit.get("replace") or edit.get("insert")
    if not isinstance(value, dict) or not isinstance(value.get("start"), dict) or not isinstance(value.get("end"), dict):
        return None
    return {"start": value["start"], "end": value["end"]}


class PyrightLanguageService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._process: asyncio.subprocess.Process | None = None
        self._reader_task: asyncio.Task[None] | None = None
        self._stderr_task: asyncio.Task[None] | None = None
        self._pending: dict[int, asyncio.Future[Any]] = {}
        self._next_request_id = 1
        self._lock = asyncio.Lock()
        self._documents: dict[tuple[int, int, int], OpenDocument] = {}
        self._completion_cache: dict[str, CachedCompletion] = {}
        self._workspace = (Path(tempfile.gettempdir()) / "kidtype-pyright").resolve()

    @property
    def enabled(self) -> bool:
        return self.settings.pyright_enabled

    async def start(self) -> None:
        if not self.enabled:
            return
        async with self._lock:
            try:
                await self._ensure_started()
            except (asyncio.TimeoutError, ConnectionError, OSError, RuntimeError) as exc:
                logger.warning("Pyright startup failed; static completion remains available: %s", exc)
                await self._stop(graceful=False)

    async def close(self) -> None:
        async with self._lock:
            await self._stop(graceful=True)

    async def complete(
        self,
        *,
        child_id: int,
        session_id: int,
        session_item_id: int,
        code: str,
        line: int,
        character: int,
        trigger_character: str | None,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"available": False, "items": []}
        self._validate_position(code, line, character)
        async with self._lock:
            for attempt in range(2):
                try:
                    await self._ensure_started()
                    document = await self._sync_document(child_id, session_id, session_item_id, code)
                    params: dict[str, Any] = {
                        "textDocument": {"uri": document.uri},
                        "position": {"line": line, "character": character},
                        "context": {"triggerKind": 2 if trigger_character else 1},
                    }
                    if trigger_character:
                        params["context"]["triggerCharacter"] = trigger_character
                    response = await asyncio.wait_for(
                        self._request("textDocument/completion", params),
                        timeout=self.settings.pyright_completion_timeout_seconds,
                    )
                    return self._normalize_completions(
                        response,
                        child_id=child_id,
                        session_id=session_id,
                        session_item_id=session_item_id,
                        document=document,
                    )
                except (asyncio.TimeoutError, ConnectionError, OSError, RuntimeError) as exc:
                    logger.warning("Pyright completion attempt %s failed: %s", attempt + 1, exc)
                    await self._stop(graceful=False)
            return {"available": False, "items": []}

    async def resolve(
        self,
        *,
        child_id: int,
        session_id: int,
        session_item_id: int,
        completion_id: str,
    ) -> dict[str, Any]:
        if not self.enabled:
            return {"available": False, "detail": "", "documentation": ""}
        async with self._lock:
            self._clean_completion_cache()
            cached = self._completion_cache.get(completion_id)
            document = self._documents.get((child_id, session_id, session_item_id))
            if (
                not cached
                or cached.child_id != child_id
                or cached.session_id != session_id
                or cached.session_item_id != session_item_id
                or not document
                or document.uri != cached.document_uri
                or document.version != cached.document_version
            ):
                return {"available": False, "detail": "", "documentation": ""}
            try:
                await self._ensure_started()
                resolved = await asyncio.wait_for(
                    self._request("completionItem/resolve", cached.item),
                    timeout=self.settings.pyright_completion_timeout_seconds,
                )
            except (asyncio.TimeoutError, ConnectionError, OSError, RuntimeError) as exc:
                logger.warning("Pyright completion resolve failed: %s", exc)
                await self._stop(graceful=False)
                return {"available": False, "detail": "", "documentation": ""}
            item = resolved if isinstance(resolved, dict) else cached.item
            return {
                "available": True,
                "detail": str(item.get("detail") or ""),
                "documentation": _documentation_text(item.get("documentation")),
            }

    async def _ensure_started(self) -> None:
        if self._process and self._process.returncode is None:
            return
        if not Path(self.settings.pyright_langserver_path).is_file():
            raise FileNotFoundError(f"Pyright language server was not found: {self.settings.pyright_langserver_path}")
        self._workspace.mkdir(parents=True, exist_ok=True)
        self._process = await asyncio.create_subprocess_exec(
            self.settings.pyright_node_path,
            self.settings.pyright_langserver_path,
            "--stdio",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        self._reader_task = asyncio.create_task(self._read_messages())
        self._stderr_task = asyncio.create_task(self._read_stderr())
        try:
            await asyncio.wait_for(self._initialize(), timeout=max(5, self.settings.pyright_completion_timeout_seconds))
        except BaseException:
            await self._stop(graceful=False)
            raise

    async def _initialize(self) -> None:
        root_uri = self._workspace.as_uri()
        await self._request("initialize", {
            "processId": None,
            "rootUri": root_uri,
            "workspaceFolders": [{"uri": root_uri, "name": "student-python"}],
            "capabilities": {
                "general": {"positionEncodings": ["utf-16"]},
                "workspace": {"configuration": True, "workspaceFolders": True},
                "textDocument": {
                    "completion": {
                        "completionItem": {
                            "snippetSupport": True,
                            "documentationFormat": ["markdown", "plaintext"],
                            "resolveSupport": {"properties": ["detail", "documentation"]},
                        },
                        "contextSupport": True,
                    },
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                },
            },
            "initializationOptions": {"disablePullDiagnostics": True},
        })
        await self._notify("initialized", {})
        await self._notify("workspace/didChangeConfiguration", {"settings": self._language_settings()})

    def _language_settings(self) -> dict[str, Any]:
        return {
            "pyright": {"disableLanguageServices": False, "disableOrganizeImports": True},
            "python": {
                "pythonPath": "/usr/local/bin/python",
                "analysis": {
                    "pythonVersion": "3.13",
                    "pythonPlatform": "Linux",
                    "typeCheckingMode": "off",
                    "diagnosticMode": "openFilesOnly",
                    "autoImportCompletions": False,
                    "autoSearchPaths": False,
                    "useLibraryCodeForTypes": False,
                },
            },
        }

    async def _sync_document(self, child_id: int, session_id: int, session_item_id: int, code: str) -> OpenDocument:
        key = (child_id, session_id, session_item_id)
        code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
        now = time.monotonic()
        document = self._documents.get(key)
        if document is None:
            uri = (self._workspace / f"child-{child_id}" / f"session-{session_id}" / f"item-{session_item_id}.py").as_uri()
            document = OpenDocument(uri=uri, version=1, code_hash=code_hash, last_used=now)
            self._documents[key] = document
            await self._notify("textDocument/didOpen", {
                "textDocument": {"uri": uri, "languageId": "python", "version": document.version, "text": code},
            })
        elif document.code_hash != code_hash:
            document.version += 1
            document.code_hash = code_hash
            document.last_used = now
            await self._notify("textDocument/didChange", {
                "textDocument": {"uri": document.uri, "version": document.version},
                "contentChanges": [{"text": code}],
            })
        else:
            document.last_used = now
        await self._evict_documents(exclude=key)
        return document

    async def _evict_documents(self, *, exclude: tuple[int, int, int]) -> None:
        cutoff = time.monotonic() - DOCUMENT_IDLE_SECONDS
        expired = [
            (key, document)
            for key, document in self._documents.items()
            if key != exclude and document.last_used < cutoff
        ]
        for key, document in expired:
            await self._notify("textDocument/didClose", {"textDocument": {"uri": document.uri}})
            self._documents.pop(key, None)
        while len(self._documents) > self.settings.pyright_max_open_documents:
            candidates = [(key, value) for key, value in self._documents.items() if key != exclude]
            if not candidates:
                return
            key, document = min(candidates, key=lambda item: item[1].last_used)
            await self._notify("textDocument/didClose", {"textDocument": {"uri": document.uri}})
            self._documents.pop(key, None)

    def _normalize_completions(
        self,
        response: Any,
        *,
        child_id: int,
        session_id: int,
        session_item_id: int,
        document: OpenDocument,
    ) -> dict[str, Any]:
        raw_items = response.get("items", []) if isinstance(response, dict) else response if isinstance(response, list) else []
        self._clean_completion_cache()
        items: list[dict[str, Any]] = []
        for raw in raw_items[:100]:
            if not isinstance(raw, dict) or not isinstance(raw.get("label"), str):
                continue
            completion_id = secrets.token_urlsafe(18)
            self._completion_cache[completion_id] = CachedCompletion(
                child_id=child_id,
                session_id=session_id,
                session_item_id=session_item_id,
                document_uri=document.uri,
                document_version=document.version,
                item=raw,
                created_at=time.monotonic(),
            )
            edit = raw.get("textEdit") if isinstance(raw.get("textEdit"), dict) else {}
            items.append({
                "id": completion_id,
                "label": raw["label"],
                "type": COMPLETION_KIND.get(raw.get("kind"), "text"),
                "detail": str(raw.get("detail") or ""),
                "documentation": _documentation_text(raw.get("documentation")),
                "insert_text": str(edit.get("newText") or raw.get("insertText") or raw["label"]),
                "insert_text_format": int(raw.get("insertTextFormat") or 1),
                "filter_text": str(raw.get("filterText") or raw["label"]),
                "sort_text": str(raw.get("sortText") or raw["label"]),
                "replace": _completion_range(raw),
            })
        return {"available": True, "items": items}

    def _clean_completion_cache(self) -> None:
        cutoff = time.monotonic() - 60
        self._completion_cache = {key: value for key, value in self._completion_cache.items() if value.created_at >= cutoff}
        if len(self._completion_cache) > self.settings.pyright_max_open_documents * 100:
            keep = sorted(self._completion_cache.items(), key=lambda item: item[1].created_at, reverse=True)[:self.settings.pyright_max_open_documents * 100]
            self._completion_cache = dict(keep)

    async def _request(self, method: str, params: Any) -> Any:
        request_id = self._next_request_id
        self._next_request_id += 1
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        try:
            await self._send({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
            response = await future
            if isinstance(response, dict) and response.get("error"):
                raise RuntimeError(str(response["error"]))
            return response.get("result") if isinstance(response, dict) else None
        finally:
            self._pending.pop(request_id, None)

    async def _notify(self, method: str, params: Any) -> None:
        await self._send({"jsonrpc": "2.0", "method": method, "params": params})

    async def _send(self, message: dict[str, Any]) -> None:
        process = self._process
        if not process or process.returncode is not None or not process.stdin:
            raise ConnectionError("Pyright language server is not running")
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        process.stdin.write(f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii") + payload)
        await process.stdin.drain()

    async def _read_messages(self) -> None:
        process = self._process
        if not process or not process.stdout:
            return
        try:
            while True:
                content_length: int | None = None
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        raise ConnectionError("Pyright language server closed stdout")
                    if line in {b"\r\n", b"\n"}:
                        break
                    name, _, value = line.decode("ascii", errors="replace").partition(":")
                    if name.lower() == "content-length":
                        content_length = int(value.strip())
                if content_length is None:
                    continue
                message = json.loads((await process.stdout.readexactly(content_length)).decode("utf-8"))
                request_id = message.get("id")
                if request_id is not None and "method" not in message:
                    future = self._pending.get(request_id)
                    if future and not future.done():
                        future.set_result(message)
                elif request_id is not None and isinstance(message.get("method"), str):
                    await self._handle_server_request(message)
        except asyncio.CancelledError:
            raise
        except BaseException as exc:
            for future in list(self._pending.values()):
                if not future.done():
                    future.set_exception(ConnectionError(str(exc)))

    async def _handle_server_request(self, message: dict[str, Any]) -> None:
        method = message.get("method")
        if method == "workspace/configuration":
            settings = self._language_settings()
            result = []
            for item in (message.get("params") or {}).get("items", []):
                section = item.get("section") if isinstance(item, dict) else None
                if section == "python.analysis":
                    result.append(settings["python"]["analysis"])
                elif section in settings:
                    result.append(settings[section])
                else:
                    result.append(None)
        elif method == "workspace/workspaceFolders":
            result = [{"uri": self._workspace.as_uri(), "name": "student-python"}]
        else:
            result = None
        await self._send({"jsonrpc": "2.0", "id": message["id"], "result": result})

    async def _read_stderr(self) -> None:
        process = self._process
        if not process or not process.stderr:
            return
        try:
            while line := await process.stderr.readline():
                logger.warning("Pyright: %s", line.decode("utf-8", errors="replace").rstrip())
        except asyncio.CancelledError:
            raise

    async def _stop(self, *, graceful: bool) -> None:
        process = self._process
        reader_task = self._reader_task
        stderr_task = self._stderr_task
        self._process = None
        self._reader_task = None
        self._stderr_task = None
        if process and process.returncode is None:
            if graceful:
                with suppress(BaseException):
                    await asyncio.wait_for(self._request_with_process(process, "shutdown", None), timeout=1)
                with suppress(BaseException):
                    await self._send_with_process(process, {"jsonrpc": "2.0", "method": "exit", "params": None})
            if process.returncode is None:
                process.terminate()
                with suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(process.wait(), timeout=1)
            if process.returncode is None:
                process.kill()
                await process.wait()
        for task in (reader_task, stderr_task):
            if task:
                task.cancel()
        for task in (reader_task, stderr_task):
            if task:
                with suppress(asyncio.CancelledError, ConnectionError):
                    await task
        for future in list(self._pending.values()):
            if not future.done():
                future.set_exception(ConnectionError("Pyright language server stopped"))
        self._pending.clear()
        self._documents.clear()
        self._completion_cache.clear()

    async def _request_with_process(self, process: asyncio.subprocess.Process, method: str, params: Any) -> Any:
        request_id = self._next_request_id
        self._next_request_id += 1
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._pending[request_id] = future
        await self._send_with_process(process, {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params})
        return await future

    @staticmethod
    async def _send_with_process(process: asyncio.subprocess.Process, message: dict[str, Any]) -> None:
        if process.returncode is not None or not process.stdin:
            return
        payload = json.dumps(message, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        process.stdin.write(f"Content-Length: {len(payload)}\r\n\r\n".encode("ascii") + payload)
        await process.stdin.drain()

    @staticmethod
    def _validate_position(code: str, line: int, character: int) -> None:
        lines = code.split("\n")
        if line >= len(lines):
            raise ValueError("补全位置超出代码范围")
        utf16_length = len(lines[line].encode("utf-16-le")) // 2
        if character > utf16_length:
            raise ValueError("补全位置超出当前行范围")
