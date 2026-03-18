from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from jose import JWTError, jwt

from app.config import settings


# ── API Key helpers ────────────────────────────────────────────────────────────

def generate_api_key() -> tuple[str, str]:
    """Return (raw_key, bcrypt_hash).

    The raw key is shown to the agent exactly once and never persisted.
    Only the hash is stored in the database.
    """
    raw = secrets.token_urlsafe(32)
    hashed = bcrypt.hashpw(raw.encode(), bcrypt.gensalt(rounds=12)).decode()
    return raw, hashed


def verify_api_key(raw_key: str, hashed_key: str) -> bool:
    """Constant-time bcrypt comparison."""
    try:
        return bcrypt.checkpw(raw_key.encode(), hashed_key.encode())
    except Exception:
        return False


# ── JWT helpers ────────────────────────────────────────────────────────────────

def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {"sub": subject, "exp": expire, "type": "access"}
    return jwt.encode(payload, settings.secret_key, algorithm="HS256")


def decode_access_token(token: str) -> Optional[str]:
    """Return the subject claim, or None if the token is invalid/expired."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=["HS256"])
        if payload.get("type") != "access":
            return None
        return payload.get("sub")
    except JWTError:
        return None


def generate_agent_id() -> str:
    """Cryptographically random 16-byte hex — used as the agent's stable ID."""
    return secrets.token_hex(16)
