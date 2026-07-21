from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.utcnow()


class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ChildProfile(Base):
    __tablename__ = "child_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    pin_hash: Mapped[str] = mapped_column(String(255))
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    attempts: Mapped[list["PracticeAttempt"]] = relationship(back_populates="child", cascade="all, delete-orphan")


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), index=True)
    actor_id: Mapped[int] = mapped_column(Integer, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    lessons: Mapped[list["Lesson"]] = relationship(back_populates="course", cascade="all, delete-orphan", order_by="Lesson.sort_order")


class Lesson(Base):
    __tablename__ = "lessons"
    __table_args__ = (UniqueConstraint("course_id", "title", name="uq_lesson_course_title"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    course: Mapped[Course] = relationship(back_populates="lessons")
    prompts: Mapped[list["Prompt"]] = relationship(back_populates="lesson", cascade="all, delete-orphan", order_by="Prompt.sort_order")


class Prompt(Base):
    __tablename__ = "prompts"
    id: Mapped[int] = mapped_column(primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id", ondelete="CASCADE"), index=True)
    content: Mapped[str] = mapped_column(Text)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    lesson: Mapped[Lesson] = relationship(back_populates="prompts")


class WordSet(Base):
    __tablename__ = "word_sets"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(Text, default="")
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    words: Mapped[list["Word"]] = relationship(back_populates="word_set", cascade="all, delete-orphan", order_by="Word.id")


class Word(Base):
    __tablename__ = "words"
    __table_args__ = (
        UniqueConstraint("word_set_id", "normalized_spelling", name="uq_word_set_normalized_spelling"),
        Index("ix_words_enrichment_queue", "enrichment_status", "next_retry_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    word_set_id: Mapped[int] = mapped_column(ForeignKey("word_sets.id", ondelete="CASCADE"), index=True)
    spelling: Mapped[str] = mapped_column(String(120))
    normalized_spelling: Mapped[str] = mapped_column(String(120))
    phonetic: Mapped[str] = mapped_column(String(160), default="")
    meaning_zh: Mapped[str] = mapped_column(Text, default="")
    technical_meaning_zh: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    enrichment_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    enrichment_attempts: Mapped[int] = mapped_column(Integer, default=0)
    enrichment_error: Mapped[str] = mapped_column(Text, default="")
    next_retry_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    word_set: Mapped[WordSet] = relationship(back_populates="words")


class PracticeAttempt(Base):
    __tablename__ = "practice_attempts"
    __table_args__ = (
        Index("ix_attempt_child_created", "child_id", "created_at"),
        Index("ix_attempt_lesson_created", "lesson_id", "created_at"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("child_profiles.id", ondelete="CASCADE"), index=True)
    course_id: Mapped[Optional[int]] = mapped_column(ForeignKey("courses.id", ondelete="SET NULL"), nullable=True)
    lesson_id: Mapped[Optional[int]] = mapped_column(ForeignKey("lessons.id", ondelete="SET NULL"), nullable=True)
    prompt_id: Mapped[Optional[int]] = mapped_column(ForeignKey("prompts.id", ondelete="SET NULL"), nullable=True)
    word_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("word_sets.id", ondelete="SET NULL"), nullable=True, index=True)
    word_id: Mapped[Optional[int]] = mapped_column(ForeignKey("words.id", ondelete="SET NULL"), nullable=True, index=True)
    prompt_snapshot: Mapped[str] = mapped_column(Text)
    duration_ms: Mapped[int] = mapped_column(Integer)
    char_count: Mapped[int] = mapped_column(Integer)
    error_count: Mapped[int] = mapped_column(Integer)
    cpm: Mapped[int] = mapped_column(Integer)
    accuracy: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    child: Mapped[ChildProfile] = relationship(back_populates="attempts")
    errors: Mapped[list["AttemptError"]] = relationship(back_populates="attempt", cascade="all, delete-orphan")


class AttemptError(Base):
    __tablename__ = "attempt_errors"
    id: Mapped[int] = mapped_column(primary_key=True)
    attempt_id: Mapped[int] = mapped_column(ForeignKey("practice_attempts.id", ondelete="CASCADE"), index=True)
    expected_char: Mapped[str] = mapped_column(String(8))
    actual_char: Mapped[str] = mapped_column(String(8))
    count: Mapped[int] = mapped_column(Integer)
    attempt: Mapped[PracticeAttempt] = relationship(back_populates="errors")


class QuestionSet(Base):
    __tablename__ = "question_sets"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(180))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="draft", index=True)
    source_pdf_asset_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    questions: Mapped[list["Question"]] = relationship(back_populates="question_set", cascade="all, delete-orphan", order_by="Question.sort_order")


class Question(Base):
    __tablename__ = "questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_set_id: Mapped[int] = mapped_column(ForeignKey("question_sets.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(24), index=True)
    stem_markdown: Mapped[str] = mapped_column(Text)
    explanation_markdown: Mapped[str] = mapped_column(Text, default="")
    points: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    correct_bool: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    source_page: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    source_asset_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_assets.id", ondelete="SET NULL"), nullable=True)
    show_source_crop: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    question_set: Mapped[QuestionSet] = relationship(back_populates="questions")
    options: Mapped[list["QuestionOption"]] = relationship(back_populates="question", cascade="all, delete-orphan", order_by="QuestionOption.sort_order")
    programming: Mapped[Optional["ProgrammingSpec"]] = relationship(back_populates="question", cascade="all, delete-orphan", uselist=False)


class QuestionOption(Base):
    __tablename__ = "question_options"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    label: Mapped[str] = mapped_column(String(16))
    content_markdown: Mapped[str] = mapped_column(Text)
    correct: Mapped[bool] = mapped_column(Boolean, default=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    question: Mapped[Question] = relationship(back_populates="options")


class ProgrammingSpec(Base):
    __tablename__ = "programming_specs"
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), primary_key=True)
    input_markdown: Mapped[str] = mapped_column(Text, default="")
    output_markdown: Mapped[str] = mapped_column(Text, default="")
    constraints_markdown: Mapped[str] = mapped_column(Text, default="")
    starter_code: Mapped[str] = mapped_column(Text, default="")
    reference_solution: Mapped[str] = mapped_column(Text, default="")
    time_limit_ms: Mapped[int] = mapped_column(Integer, default=1000)
    memory_limit_mb: Mapped[int] = mapped_column(Integer, default=128)
    question: Mapped[Question] = relationship(back_populates="programming")
    cases: Mapped[list["ProgrammingCase"]] = relationship(back_populates="programming", cascade="all, delete-orphan", order_by="ProgrammingCase.id")


class ProgrammingCase(Base):
    __tablename__ = "programming_cases"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("programming_specs.question_id", ondelete="CASCADE"), index=True)
    input_data: Mapped[str] = mapped_column(Text, default="")
    expected_output: Mapped[str] = mapped_column(Text, default="")
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    weight: Mapped[int] = mapped_column(Integer, default=0)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str] = mapped_column(Text, default="")
    programming: Mapped[ProgrammingSpec] = relationship(back_populates="cases")


class QuestionAsset(Base):
    __tablename__ = "question_assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    question_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_sets.id", ondelete="CASCADE"), nullable=True, index=True)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    original_name: Mapped[str] = mapped_column(String(255), default="")
    mime_type: Mapped[str] = mapped_column(String(100))
    kind: Mapped[str] = mapped_column(String(24), default="question")
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class QuestionImportJob(Base):
    __tablename__ = "question_import_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    source_asset_id: Mapped[int] = mapped_column(ForeignKey("question_assets.id", ondelete="CASCADE"), index=True)
    question_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_sets.id", ondelete="SET NULL"), nullable=True)
    page_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")
    diagnostics_json: Mapped[str] = mapped_column(Text, default="{}")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    processing_started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class ExerciseSession(Base):
    __tablename__ = "exercise_sessions"
    __table_args__ = (Index("ix_exercise_session_child_created", "child_id", "created_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("child_profiles.id", ondelete="CASCADE"), index=True)
    mode: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="in_progress", index=True)
    config_json: Mapped[str] = mapped_column(Text, default="{}")
    title: Mapped[str] = mapped_column(String(180), default="习题练习")
    score: Mapped[int] = mapped_column(Integer, default=0)
    max_score: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    items: Mapped[list["ExerciseSessionItem"]] = relationship(back_populates="session", cascade="all, delete-orphan", order_by="ExerciseSessionItem.sort_order")


class ExerciseSessionItem(Base):
    __tablename__ = "exercise_session_items"
    __table_args__ = (UniqueConstraint("session_id", "sort_order", name="uq_exercise_session_item_order"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("exercise_sessions.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[Optional[int]] = mapped_column(ForeignKey("questions.id", ondelete="SET NULL"), nullable=True, index=True)
    question_set_id: Mapped[Optional[int]] = mapped_column(ForeignKey("question_sets.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer)
    points: Mapped[int] = mapped_column(Integer)
    snapshot_json: Mapped[str] = mapped_column(Text)
    session: Mapped[ExerciseSession] = relationship(back_populates="items")
    answer: Mapped[Optional["ExerciseAnswer"]] = relationship(back_populates="item", cascade="all, delete-orphan", uselist=False)


class ExerciseAnswer(Base):
    __tablename__ = "exercise_answers"
    id: Mapped[int] = mapped_column(primary_key=True)
    session_item_id: Mapped[int] = mapped_column(ForeignKey("exercise_session_items.id", ondelete="CASCADE"), unique=True, index=True)
    answer_json: Mapped[str] = mapped_column(Text, default="{}")
    code: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(24), default="unanswered")
    awarded_points: Mapped[int] = mapped_column(Integer, default=0)
    details_json: Mapped[str] = mapped_column(Text, default="{}")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    item: Mapped[ExerciseSessionItem] = relationship(back_populates="answer")


class WrongQuestion(Base):
    __tablename__ = "wrong_questions"
    __table_args__ = (UniqueConstraint("child_id", "question_id", name="uq_wrong_child_question"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    child_id: Mapped[int] = mapped_column(ForeignKey("child_profiles.id", ondelete="CASCADE"), index=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("questions.id", ondelete="CASCADE"), index=True)
    wrong_count: Mapped[int] = mapped_column(Integer, default=1)
    mastered: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    last_wrong_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    mastered_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

