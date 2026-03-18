from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class NotificationChannel(Base):
    """
    A configured notification channel.

    type: 'gotify' | 'ntfy' | 'email' | 'webhook'
    config: JSON blob containing channel-specific settings:
        gotify:  { "url": "https://gotify.example.com", "token": "...", "priority": 5 }
        ntfy:    { "url": "https://ntfy.sh", "topic": "syswarden", "priority": "default" }
        email:   { "smtp_host": "...", "smtp_port": 587, "smtp_user": "...",
                   "smtp_password": "...", "smtp_tls": true,
                   "from_addr": "...", "to_addrs": "a@b.com,c@d.com" }
        webhook: { "url": "https://...", "headers": {} }
    """
    __tablename__ = "notification_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False)  # gotify|ntfy|email|webhook
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Channel-specific credentials / config stored as a JSON string
    config: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    # Which events trigger this channel
    notify_agent_offline: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_agent_online: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notify_monitor_down: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notify_monitor_up: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
