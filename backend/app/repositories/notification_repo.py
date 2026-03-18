from __future__ import annotations

from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.notification_channel import NotificationChannel


class NotificationChannelRepo:

    def list_all(self, db: Session) -> List[NotificationChannel]:
        return db.query(NotificationChannel).order_by(NotificationChannel.id).all()

    def list_enabled_for_event(self, db: Session, event_type: str) -> List[NotificationChannel]:
        """Return enabled channels that subscribe to the given event type.

        event_type: 'agent_offline' | 'agent_online' | 'monitor_down' | 'monitor_up'
        """
        col = {
            "agent_offline": NotificationChannel.notify_agent_offline,
            "agent_online":  NotificationChannel.notify_agent_online,
            "monitor_down":  NotificationChannel.notify_monitor_down,
            "monitor_up":    NotificationChannel.notify_monitor_up,
        }.get(event_type)
        if col is None:
            return []
        return (
            db.query(NotificationChannel)
            .filter(NotificationChannel.enabled.is_(True), col.is_(True))
            .all()
        )

    def get_by_id(self, db: Session, channel_id: int) -> Optional[NotificationChannel]:
        return db.query(NotificationChannel).filter(NotificationChannel.id == channel_id).first()

    def create(self, db: Session, **kwargs) -> NotificationChannel:
        ch = NotificationChannel(**kwargs)
        db.add(ch)
        db.commit()
        db.refresh(ch)
        return ch

    def update(self, db: Session, channel_id: int, **kwargs) -> Optional[NotificationChannel]:
        ch = self.get_by_id(db, channel_id)
        if not ch:
            return None
        for k, v in kwargs.items():
            setattr(ch, k, v)
        db.commit()
        db.refresh(ch)
        return ch

    def delete(self, db: Session, channel_id: int) -> bool:
        ch = self.get_by_id(db, channel_id)
        if not ch:
            return False
        db.delete(ch)
        db.commit()
        return True


notification_channel_repo = NotificationChannelRepo()
