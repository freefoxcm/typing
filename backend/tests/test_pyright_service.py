import asyncio
import shutil
from pathlib import Path

import pytest

from app.config import Settings
from app.pyright_service import PyrightLanguageService


def test_real_pyright_completes_list_and_user_class_members():
    node = shutil.which("node")
    langserver = Path(__file__).resolve().parents[2] / "frontend" / "node_modules" / "pyright" / "langserver.index.js"
    if not node or not langserver.exists():
        pytest.skip("Pyright development dependency is not installed")

    service = PyrightLanguageService(Settings(
        pyright_node_path=node,
        pyright_langserver_path=str(langserver),
        pyright_completion_timeout_seconds=5,
        pyright_max_open_documents=1,
        seed_demo_data=False,
    ))

    async def verify() -> None:
        try:
            list_result = await service.complete(
                child_id=1,
                session_id=2,
                session_item_id=3,
                code="vals = []\nvals.",
                line=1,
                character=5,
                trigger_character=".",
            )
            assert list_result["available"] is True
            assert "append" in {item["label"] for item in list_result["items"]}

            for code, line, character, expected in [
                ("mapping = {}\nmapping.", 1, 8, "get"),
                ("message = 'hello'\nmessage.", 1, 8, "upper"),
                ("import math\nmath.", 1, 5, "sqrt"),
            ]:
                result = await service.complete(
                    child_id=1,
                    session_id=2,
                    session_item_id=3,
                    code=code,
                    line=line,
                    character=character,
                    trigger_character=".",
                )
                assert result["available"] is True
                assert expected in {item["label"] for item in result["items"]}

            class_code = "class Counter:\n    def increment(self, amount: int = 1):\n        return amount\n\ncounter = Counter()\ncounter."
            class_result = await service.complete(
                child_id=1,
                session_id=2,
                session_item_id=4,
                code=class_code,
                line=5,
                character=8,
                trigger_character=".",
            )
            assert class_result["available"] is True
            assert "increment" in {item["label"] for item in class_result["items"]}
            assert set(service._documents) == {(1, 2, 4)}
        finally:
            await service.close()

    asyncio.run(verify())


def test_pyright_rejects_positions_outside_the_document():
    service = PyrightLanguageService(Settings(seed_demo_data=False))
    with pytest.raises(ValueError, match="超出代码范围"):
        asyncio.run(service.complete(
            child_id=1,
            session_id=2,
            session_item_id=3,
            code="print(1)",
            line=2,
            character=0,
            trigger_character=None,
        ))


def test_pyright_restarts_once_then_returns_the_static_fallback_state():
    class FailingService(PyrightLanguageService):
        def __init__(self):
            super().__init__(Settings(seed_demo_data=False))
            self.start_attempts = 0
            self.stop_attempts = 0

        async def _ensure_started(self) -> None:
            self.start_attempts += 1
            raise ConnectionError("language server unavailable")

        async def _stop(self, *, graceful: bool) -> None:
            self.stop_attempts += 1

    service = FailingService()
    result = asyncio.run(service.complete(
        child_id=1,
        session_id=2,
        session_item_id=3,
        code="items.",
        line=0,
        character=6,
        trigger_character=".",
    ))
    assert result == {"available": False, "items": []}
    assert service.start_attempts == 2
    assert service.stop_attempts == 2
