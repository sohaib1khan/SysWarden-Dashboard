from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class AlertRule(Base):
    """
    A threshold rule evaluated on every metric ingest.

    condition: 'gt' | 'lt' | 'gte' | 'lte'
    duration_s: how many seconds the breach must persist before firing
                (0 = fire immediately on first breach)
    """
    __tablename__ = "alert_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    agent_id: Mapped[str] = mapped_column(String(32), ForeignKey("agents.id", ondelete="CASCADE"), nullable=False)
    metric_name: Mapped[str] = mapped_column(String(64), nullable=False)
    condition: Mapped[str] = mapped_column(String(8), nullable=False)   # gt/lt/gte/lte
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    duration_s: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Webhook URL to POST when the rule fires (Slack/Discord/generic)
    webhook_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class AlertEvent(Base):
    """A record of every time an AlertRule fired."""
    __tablename__ = "alert_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rule_id: Mapped[int] = mapped_column(Integer, ForeignKey("alert_rules.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(32), nullable=False)
    metric_name: Mapped[str] = mapped_column(String(64), nullable=False)
    value: Mapped[float] = mapped_column(Float, nullable=False)
    threshold: Mapped[float] = mapped_column(Float, nullable=False)
    condition: Mapped[str] = mapped_column(String(8), nullable=False)
    fired_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    notified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
