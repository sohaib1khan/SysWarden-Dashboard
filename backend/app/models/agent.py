from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Agent(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    hostname: Mapped[str] = mapped_column(String(253), nullable=False)
    # bcrypt hash — plaintext is never stored
    api_key_hash: Mapped[str] = mapped_column(String(256), nullable=False)
    capabilities: Mapped[str] = mapped_column(String(512), default="")
    registered_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
