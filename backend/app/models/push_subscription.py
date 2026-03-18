from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class PushSubscription(Base):
    """
    Stores a Web Push API subscription object (one per browser/device).
    The endpoint is globally unique — re-subscribing the same device
    upserts rather than creating a duplicate.
    """
    __tablename__ = "push_subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # The push service URL (uniquely identifies this subscription)
    endpoint: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    # ECDH public key (base64url, from subscription.keys.p256dh)
    p256dh: Mapped[str] = mapped_column(String(128), nullable=False)
    # Authentication secret (base64url, from subscription.keys.auth)
    auth: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
