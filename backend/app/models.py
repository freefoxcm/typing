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

