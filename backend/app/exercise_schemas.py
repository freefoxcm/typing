from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


QuestionType = Literal["single_choice", "multiple_choice", "true_false", "programming"]


class QuestionSetWrite(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    description: str = Field(default="", max_length=5000)

    @field_validator("title", mode="before")
    @classmethod
    def strip_title(cls, value: str) -> str:
        return value.strip() if isinstance(value, str) else value


class QuestionSetOrder(BaseModel):
    question_set_ids: list[int] = Field(min_length=1, max_length=10000)


class QuestionOrder(BaseModel):
    question_ids: list[int] = Field(min_length=1, max_length=10000)


class OptionWrite(BaseModel):
    label: str = Field(min_length=1, max_length=16)
    content_markdown: str = Field(min_length=1, max_length=10000)
    correct: bool = False
    sort_order: int = Field(default=0, ge=0, le=10000)


class ProgrammingCaseWrite(BaseModel):
    input_data: str = Field(default="", max_length=100000)
    expected_output: str = Field(default="", max_length=100000)
    is_sample: bool = False
    weight: int = Field(default=0, ge=0, le=10000)
    confirmed: bool = False
    note: str = Field(default="", max_length=1000)


class ProgrammingWrite(BaseModel):
    input_markdown: str = Field(default="", max_length=20000)
    output_markdown: str = Field(default="", max_length=20000)
    constraints_markdown: str = Field(default="", max_length=20000)
    starter_code: str = Field(default="", max_length=100000)
    reference_solution: str = Field(default="", max_length=100000)
    time_limit_ms: int = Field(default=1000, ge=100, le=5000)
    memory_limit_mb: int = Field(default=128, ge=32, le=512)
    cases: list[ProgrammingCaseWrite] = Field(default_factory=list, max_length=200)


class QuestionWrite(BaseModel):
    type: QuestionType
    stem_markdown: str = Field(min_length=1, max_length=50000)
    explanation_markdown: str = Field(default="", max_length=50000)
    points: int = Field(default=1, ge=1, le=10000)
    sort_order: int = Field(default=0, ge=0, le=10000)
    reviewed: bool = False
    correct_bool: bool | None = None
    source_page: int | None = Field(default=None, ge=1, le=10000)
    source_asset_id: int | None = Field(default=None, gt=0)
    show_source_crop: bool = False
    options: list[OptionWrite] = Field(default_factory=list, max_length=20)
    programming: ProgrammingWrite | None = None

    @model_validator(mode="after")
    def validate_shape(self):
        if self.type in {"single_choice", "multiple_choice"}:
            if len(self.options) < 2:
                raise ValueError("选择题至少需要两个选项")
            correct_count = sum(item.correct for item in self.options)
            if self.type == "single_choice" and correct_count != 1:
                raise ValueError("单选题必须且只能有一个正确选项")
            if self.type == "multiple_choice" and correct_count < 1:
                raise ValueError("多选题至少需要一个正确选项")
        elif self.type == "true_false" and self.correct_bool is None:
            raise ValueError("判断题必须设置正确答案")
        elif self.type == "programming" and self.programming is None:
            raise ValueError("编程题必须包含编程规格")
        return self


class SessionCreate(BaseModel):
    mode: Literal["set", "random", "wrong"]
    question_set_ids: list[int] = Field(default_factory=list, max_length=100)
    counts: dict[str, int] = Field(default_factory=dict)

    @field_validator("question_set_ids")
    @classmethod
    def unique_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(value) != len(set(value)):
            raise ValueError("题套 ID 必须是不重复的正整数")
        return value

    @field_validator("counts")
    @classmethod
    def valid_counts(cls, value: dict[str, int]) -> dict[str, int]:
        allowed = {"single_choice", "multiple_choice", "true_false", "programming"}
        if any(key not in allowed or not isinstance(count, int) or count < 0 or count > 200 for key, count in value.items()):
            raise ValueError("抽题数量无效")
        return value


class AnswerWrite(BaseModel):
    selected_option_ids: list[int] = Field(default_factory=list, max_length=20)
    bool_answer: bool | None = None
    code: str = Field(default="", max_length=100000)

    @field_validator("selected_option_ids")
    @classmethod
    def unique_options(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("选项不能重复")
        return value


class SampleRunCreate(BaseModel):
    session_item_id: int = Field(gt=0)
    code: str = Field(min_length=1, max_length=100000)
