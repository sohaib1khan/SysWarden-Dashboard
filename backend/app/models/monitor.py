from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Boolean, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Monitor(Base):
    """An external service endpoint to probe on a schedule."""

    __tablename__ = "monitors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # 'http' | 'tcp' | 'keyword'
    type: Mapped[str] = mapped_column(String(16), nullable=False, default="http")
    # Full URL for http/keyword; hostname/IP for tcp
    url: Mapped[str] = mapped_column(String(512), nullable=False)
    # TCP port (tcp type only)
    port: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # keyword to search in response body (keyword type only)
    keyword: Mapped[str | None] = mapped_column(String(256), nullable=True)
    # HTTP method — GET or HEAD (http/keyword only)
    method: Mapped[str] = mapped_column(String(8), nullable=False, default="GET")
    # How often to check (seconds)
    interval_s: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    # Per-request timeout (seconds)
    timeout_s: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    # Whether the monitor is active; paused monitors are skipped by the checker
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Latest resolved status
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    # Timestamp of the last completed check
    last_checked: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Response time of the last check
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False
    )
    # Group / category name for organising monitors on the status page
    group_name: Mapped[str] = mapped_column(String(128), nullable=False, default="General")
    # Display order within the group (lower = higher on the page)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # ── Advanced options ───────────────────────────────────────────────────────
    # Ignore TLS/SSL certificate errors (self-signed certs, expired, etc.)
    ignore_tls: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Append a random cache-busting query parameter to every HTTP request
    # so CDNs / proxies cannot return a stale cached response
    cache_buster: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Upside-down mode: treat a *reachable* endpoint as DOWN and vice-versa
    upside_down: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Fire a notification when the TLS certificate expires within this many
    # days (0 = disabled). Only applies to https:// monitors.
    notify_cert_expiry_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # How many checks in a row have returned 'down'.  Only flips status to
    # 'down' once this reaches the threshold — filters out single-check blips.
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class MonitorEvent(Base):
    """One check result for a monitor (stores the last 1 000 per monitor)."""

    __tablename__ = "monitor_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    monitor_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(8), nullable=False)   # 'up' | 'down'
    response_time_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_msg: Mapped[str | None] = mapped_column(String(512), nullable=True)
    checked_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )
