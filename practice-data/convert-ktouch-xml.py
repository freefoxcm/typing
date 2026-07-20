#!/usr/bin/env python3
"""Convert a KTouch course XML file into a KidType import JSON file."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET


DEFAULT_SOURCE = "https://et.abcoding.cn/dazi/lessons/us.xml"


def read_source(source: str) -> bytes:
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        request = Request(source, headers={"User-Agent": "KidType KTouch converter"})
        with urlopen(request, timeout=30) as response:
            return response.read()
    return Path(source).read_bytes()


def convert(xml_data: bytes) -> dict[str, object]:
    root = ET.fromstring(xml_data)
    if root.tag != "course":
        raise ValueError("XML root element must be <course>")

    lessons: list[dict[str, object]] = []
    for lesson_index, lesson in enumerate(root.findall("./lessons/lesson")):
        prompts = []
        text = lesson.findtext("text", default="")
        for line in text.splitlines():
            if not line.strip():
                continue
            prompts.append(
                {
                    "content": line.rstrip(),
                    "sort_order": len(prompts),
                    "active": True,
                }
            )

        new_characters = lesson.findtext("newCharacters", default="")
        lessons.append(
            {
                "title": lesson.findtext("title", default="").strip(),
                "description": f"New characters: {new_characters}",
                "sort_order": lesson_index,
                "active": True,
                "prompts": prompts,
            }
        )

    return {
        "version": 1,
        "courses": [
            {
                "title": root.findtext("title", default="").strip(),
                "description": root.findtext("description", default="").strip(),
                "sort_order": 0,
                "active": True,
                "lessons": lessons,
            }
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "source",
        nargs="?",
        default=DEFAULT_SOURCE,
        help=f"KTouch XML path or URL (default: {DEFAULT_SOURCE})",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=Path(__file__).with_name("us.json"),
        help="output JSON path (default: practice-data/us.json)",
    )
    args = parser.parse_args()

    payload = convert(read_source(args.source))
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
