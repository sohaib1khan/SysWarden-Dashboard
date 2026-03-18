from __future__ import annotations

from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Database
    database_url: str = "sqlite:////app/data/syswarden.db"

    # JWT — must be set via env var in production
    secret_key: str = "insecure_default_change_me"

    # CORS — stored as a plain str so pydantic-settings v2 does NOT attempt
    # JSON decoding (which it does for List[str] fields and breaks on bare URLs).
    # Use get_allowed_origins() wherever a parsed list is needed.
    # e.g.  ALLOWED_ORIGINS=http://localhost:5173,https://myapp.example.com
    allowed_origins: str = "http://localhost:5173"

    def get_allowed_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # Token expiry
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    # Rate limiting applied to ingest + fetch endpoints
    rate_limit: str = "60/minute"

    # Max incoming request body size (bytes) — 1 MB default
    max_request_size: int = 1_048_576

    # Web Push / VAPID — generate once with `python -c "from py_vapid import Vapid; v=Vapid(); v.generate_keys(); print(v.private_key.decode(), v.public_key.decode())"`
    # Leave empty to disable push notifications.
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_email: str = "mailto:admin@localhost"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
