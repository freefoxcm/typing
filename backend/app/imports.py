import csv
import io
import json
from dataclasses import dataclass, field
from typing import Any


def validate_prompt(content: str) -> str | None:
    if not content:
        return "练习内容不能为空"
    if len(content) > 5000:
        return "单条练习不能超过 5000 个字符"
    for char in content:
        code = ord(char)
        if char in "\n\t":
            continue
        if code < 32 or code > 126:
            return f"包含不支持的字符 U+{code:04X}"
    return None


@dataclass
class ImportPrompt:
    course: str
    lesson: str
    prompt: str
    order: int = 0
    enabled: bool = True


@dataclass
class ImportResult:
    items: list[ImportPrompt] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {
            "valid": not self.errors,
            "prompt_count": len(self.items),
            "course_count": len({item.course for item in self.items if item.course}),
            "lesson_count": len({(item.course, item.lesson) for item in self.items if item.lesson}),
            "errors": self.errors[:100],
        }


def _bool(value: Any) -> bool:
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def parse_import(format_name: str, content: str, target_lesson_title: str = "") -> ImportResult:
    result = ImportResult()
    fmt = format_name.lower().strip()
    try:
        if fmt == "txt":
            for index, line in enumerate(content.splitlines(), start=1):
                if not line.strip():
                    continue
                error = validate_prompt(line)
                if error:
                    result.errors.append(f"第 {index} 行：{error}")
                else:
                    result.items.append(ImportPrompt("", target_lesson_title, line, len(result.items)))
        elif fmt == "csv":
            reader = csv.DictReader(io.StringIO(content))
            required = {"course", "lesson", "prompt"}
            if not reader.fieldnames or not required.issubset(reader.fieldnames):
                return ImportResult(errors=["CSV 必须包含 course、lesson、prompt 列"])
            for index, row in enumerate(reader, start=2):
                course = (row.get("course") or "").strip()
                lesson = (row.get("lesson") or "").strip()
                prompt = row.get("prompt") or ""
                if not course or not lesson:
                    result.errors.append(f"第 {index} 行：课程和关卡名称不能为空")
                    continue
                error = validate_prompt(prompt)
                if error:
                    result.errors.append(f"第 {index} 行：{error}")
                    continue
                try:
                    order = int(row.get("order") or len(result.items))
                except ValueError:
                    result.errors.append(f"第 {index} 行：order 必须是整数")
                    continue
                result.items.append(ImportPrompt(course, lesson, prompt, order, _bool(row.get("enabled", True))))
        elif fmt == "json":
            payload = json.loads(content)
            courses = payload.get("courses") if isinstance(payload, dict) else None
            if not isinstance(courses, list):
                return ImportResult(errors=["JSON 根对象必须包含 courses 数组"])
            for course_index, course in enumerate(courses):
                course_title = str(course.get("title", "")).strip()
                if not course_title:
                    result.errors.append(f"第 {course_index + 1} 个课程缺少标题")
                    continue
                for lesson_index, lesson in enumerate(course.get("lessons", [])):
                    lesson_title = str(lesson.get("title", "")).strip()
                    if not lesson_title:
                        result.errors.append(f"课程 {course_title} 的第 {lesson_index + 1} 个关卡缺少标题")
                        continue
                    for prompt_index, prompt in enumerate(lesson.get("prompts", [])):
                        if isinstance(prompt, str):
                            prompt = {"content": prompt}
                        prompt_content = str(prompt.get("content", ""))
                        error = validate_prompt(prompt_content)
                        if error:
                            result.errors.append(f"{course_title}/{lesson_title} 第 {prompt_index + 1} 条：{error}")
                            continue
                        result.items.append(ImportPrompt(
                            course_title,
                            lesson_title,
                            prompt_content,
                            int(prompt.get("sort_order", prompt_index)),
                            bool(prompt.get("active", True)),
                        ))
        else:
            result.errors.append("仅支持 txt、csv、json 格式")
    except (csv.Error, json.JSONDecodeError, TypeError, ValueError) as exc:
        result.errors.append(f"文件解析失败：{exc}")
    if not result.items and not result.errors:
        result.errors.append("没有找到可导入的练习内容")
    return result

