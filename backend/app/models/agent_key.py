from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AgentKey(Base):
    """
    Server-side storage for agent API keys (plaintext).

    Storing in cleartext is acceptable for this self-hosted tool because:
    - Access requires a valid user JWT (protected behind auth)
    - This mirrors what browsers already store in localStorage
    - The DB lives on the same host as .env / SECRET_KEY

    One or more labelled keys can be saved per agent (e.g. "primary", "backup").
    """

    __tablename__ = "agent_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    label: Mapped[str] = mapped_column(String(128), nullable=False, default="default")
    key_value: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
