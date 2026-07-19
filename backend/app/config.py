from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "码力全开"
    database_url: str = "sqlite:////data/typing.db"
    admin_username: str = "admin"
    admin_password: str = "change-me-now"
    session_secret: str = "development-only-change-me"
    session_hours: int = 12
    cookie_secure: bool = False
    trusted_hosts: str = "*"
    frontend_dist: str = str(Path(__file__).resolve().parents[2] / "frontend" / "dist")
    auto_create_schema: bool = True
    seed_demo_data: bool = True
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def hosts(self) -> list[str]:
        return [part.strip() for part in self.trusted_hosts.split(",") if part.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
