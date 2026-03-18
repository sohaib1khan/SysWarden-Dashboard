from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.alert import AlertEvent, AlertRule


class AlertRuleRepo:
    def create(self, db: Session, **kwargs) -> AlertRule:
        rule = AlertRule(**kwargs)
        db.add(rule)
        db.commit()
        db.refresh(rule)
        return rule

    def list_for_agent(self, db: Session, agent_id: str) -> List[AlertRule]:
        return (
            db.query(AlertRule)
            .filter(AlertRule.agent_id == agent_id)
            .order_by(AlertRule.created_at.desc())
            .all()
        )

    def list_all(self, db: Session) -> List[AlertRule]:
        return db.query(AlertRule).order_by(AlertRule.created_at.desc()).all()

    def get(self, db: Session, rule_id: int) -> Optional[AlertRule]:
        return db.query(AlertRule).filter(AlertRule.id == rule_id).first()

    def list_enabled_for_metric(
        self, db: Session, agent_id: str, metric_name: str
    ) -> List[AlertRule]:
        return (
            db.query(AlertRule)
            .filter(
                AlertRule.agent_id == agent_id,
                AlertRule.metric_name == metric_name,
                AlertRule.enabled.is_(True),
            )
            .all()
        )

    def update_enabled(self, db: Session, rule_id: int, enabled: bool) -> Optional[AlertRule]:
        rule = self.get(db, rule_id)
        if rule:
            rule.enabled = enabled
            db.commit()
            db.refresh(rule)
        return rule

    def delete(self, db: Session, rule_id: int) -> bool:
        rule = self.get(db, rule_id)
        if not rule:
            return False
        db.delete(rule)
        db.commit()
        return True


class AlertEventRepo:
    def create(self, db: Session, **kwargs) -> AlertEvent:
        event = AlertEvent(**kwargs)
        db.add(event)
        db.commit()
        db.refresh(event)
        return event

    def list_recent(
        self,
        db: Session,
        limit: int = 100,
        agent_id: Optional[str] = None,
    ) -> List[AlertEvent]:
        q = db.query(AlertEvent)
        if agent_id:
            q = q.filter(AlertEvent.agent_id == agent_id)
        return q.order_by(AlertEvent.fired_at.desc()).limit(limit).all()

    def mark_notified(self, db: Session, event_id: int) -> None:
        event = db.query(AlertEvent).filter(AlertEvent.id == event_id).first()
        if event:
            event.notified = True
            db.commit()


alert_rule_repo = AlertRuleRepo()
alert_event_repo = AlertEventRepo()
