from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class AdminLogin(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)


class ChildLogin(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    pin: str = Field(pattern=r"^\d{4,6}$")

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class ChildCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    pin: str = Field(pattern=r"^\d{4,6}$")
    active: bool = True


class ChildUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    pin: str | None = Field(default=None, pattern=r"^\d{4,6}$")
    active: bool | None = None


class CourseWrite(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=100000)
    active: bool = True


class LessonWrite(BaseModel):
    course_id: int
    title: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=100000)
    active: bool = True


class PromptWrite(BaseModel):
    lesson_id: int
    content: str = Field(min_length=1, max_length=5000)
    sort_order: int = Field(default=0, ge=0, le=100000)
    active: bool = True

    @field_validator("content")
    @classmethod
    def supported_content(cls, value: str) -> str:
        from .imports import validate_prompt
        error = validate_prompt(value)
        if error:
            raise ValueError(error)
        return value


class ErrorItem(BaseModel):
    expected_char: str = Field(min_length=1, max_length=8)
    actual_char: str = Field(min_length=1, max_length=8)
    count: int = Field(ge=1, le=10000)


class AttemptCreate(BaseModel):
    prompt_id: int
    duration_ms: int = Field(ge=100, le=86_400_000)
    errors: list[ErrorItem] = Field(default_factory=list, max_length=500)


class ImportRequest(BaseModel):
    format: str = Field(pattern=r"^(txt|csv|json)$")
    content: str = Field(min_length=1, max_length=5_000_000)
    mode: str = Field(default="append", pattern=r"^(append|replace)$")
    target_lesson_id: int | None = None
