import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


QuestionType = Literal["single_choice", "multiple_choice", "true_false", "fill_blank", "programming"]


class ExerciseImportRequest(BaseModel):
    format: Literal["txt", "csv", "json"]
    content: str = Field(min_length=1, max_length=10_000_000)
    mode: Literal["create", "append"] = "create"
    target_question_set_id: int | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def validate_target(self):
        if self.mode == "append" and self.target_question_set_id is None:
            raise ValueError("追加模式必须选择目标草稿题套")
        return self


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


class QuestionBundleExportRequest(BaseModel):
    question_set_ids: list[int] = Field(min_length=1, max_length=50)

    @field_validator("question_set_ids")
    @classmethod
    def unique_question_set_ids(cls, value: list[int]) -> list[int]:
        if any(item <= 0 for item in value) or len(value) != len(set(value)):
            raise ValueError("题套不能重复且必须为正整数")
        return value


class ReviewWrite(BaseModel):
    reviewed: bool


class ReferenceOutputApply(BaseModel):
    case_ids: list[int] = Field(min_length=1, max_length=200)

    @field_validator("case_ids")
    @classmethod
    def unique_case_ids(cls, value: list[int]) -> list[int]:
        if len(value) != len(set(value)):
            raise ValueError("测试点不能重复")
        return value


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


class BlankWrite(BaseModel):
    position: int = Field(ge=1, le=100)
    accepted_answers: list[str] = Field(min_length=1, max_length=50)

    @field_validator("accepted_answers")
    @classmethod
    def clean_answers(cls, value: list[str]) -> list[str]:
        answers: list[str] = []
        for item in value:
            answer = str(item).strip()
            if not answer:
                raise ValueError("可接受答案不能为空")
            if len(answer) > 10000:
                raise ValueError("单个填空答案不能超过 10000 字符")
            if answer not in answers:
                answers.append(answer)
        return answers


class QuestionWrite(BaseModel):
    type: QuestionType
    stem_markdown: str = Field(min_length=1, max_length=50000)
    explanation_markdown: str = Field(default="", max_length=50000)
    points: int = Field(default=1, ge=1, le=10000)
    sort_order: int = Field(default=0, ge=0, le=10000)
    reviewed: bool = False
    correct_bool: bool | None = None
    source_page: int | None = Field(default=None, ge=1, le=10000)
    source_end_page: int | None = Field(default=None, ge=1, le=10000)
    source_section: str = Field(default="", max_length=180)
    source_number: str = Field(default="", max_length=80)
    recognition_confidence: float | None = Field(default=None, ge=0, le=1)
    recognition_warnings: list[str] = Field(default_factory=list, max_length=100)
    source_asset_id: int | None = Field(default=None, gt=0)
    stem_image_asset_id: int | None = Field(default=None, gt=0)
    show_source_crop: bool = False
    options: list[OptionWrite] = Field(default_factory=list, max_length=20)
    blanks: list[BlankWrite] = Field(default_factory=list, max_length=100)
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
        elif self.type == "fill_blank":
            positions = [item.position for item in self.blanks]
            if positions != list(range(1, len(self.blanks) + 1)):
                raise ValueError("填空位置必须从 1 开始连续编号")
            markers = [int(item) for item in re.findall(r"\{\{(\d+)\}\}", self.stem_markdown)]
            if markers != positions:
                raise ValueError("题面填空占位符必须与填空答案按顺序一一对应")
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
        allowed = {"single_choice", "multiple_choice", "true_false", "fill_blank", "programming"}
        if any(key not in allowed or not isinstance(count, int) or count < 0 or count > 200 for key, count in value.items()):
            raise ValueError("抽题数量无效")
        return value


class AnswerWrite(BaseModel):
    selected_option_ids: list[int] = Field(default_factory=list, max_length=20)
    bool_answer: bool | None = None
    blank_answers: list[str] = Field(default_factory=list, max_length=100)
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


class SyntaxCheckCreate(BaseModel):
    session_item_id: int = Field(gt=0)
    code: str = Field(default="", max_length=100000)
