from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PluginScript(Base):
    """A script stored on the backend that agents can auto-download and run.

    Two types are supported:
      metric     — script runs on a schedule and pushes metric JSON to stdout
      capability — script is invoked on-demand with JSON params on stdin and
                   writes a JSON response to stdout; registered as a live
                   capability handler on the agent side.
    """

    __tablename__ = "plugin_scripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    script: Mapped[str] = mapped_column(Text, nullable=False)
    checksum: Mapped[str] = mapped_column(String(64), nullable=False)  # SHA-256 hex
    version: Mapped[str] = mapped_column(String(32), default="1.0.0", nullable=False)
    plugin_type: Mapped[str] = mapped_column(String(32), default="metric", nullable=False)
    # Only populated when plugin_type == "capability"
    capability_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False
    )
