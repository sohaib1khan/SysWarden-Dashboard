from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.agent_key import AgentKey


class AgentKeyRepo:
    def list_for_agent(self, db: Session, agent_id: str) -> List[AgentKey]:
        return (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent_id)
            .order_by(AgentKey.created_at.desc())
            .all()
        )

    def get(self, db: Session, key_id: int) -> Optional[AgentKey]:
        return db.get(AgentKey, key_id)

    def upsert(
        self, db: Session, agent_id: str, key_value: str, label: str = "default"
    ) -> AgentKey:
        """Insert or replace the key with the same agent_id + label."""
        existing = (
            db.query(AgentKey)
            .filter(AgentKey.agent_id == agent_id, AgentKey.label == label)
            .first()
        )
        if existing:
            existing.key_value = key_value
            existing.created_at = datetime.utcnow()
            existing.verified_at = None
            db.commit()
            db.refresh(existing)
            return existing

        row = AgentKey(agent_id=agent_id, label=label, key_value=key_value)
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    def delete(self, db: Session, key_id: int) -> bool:
        row = db.get(AgentKey, key_id)
        if not row:
            return False
        db.delete(row)
        db.commit()
        return True

    def mark_verified(self, db: Session, key_id: int) -> None:
        row = db.get(AgentKey, key_id)
        if row:
            row.verified_at = datetime.utcnow()
            db.commit()

    def delete_all_for_agent(self, db: Session, agent_id: str) -> None:
        db.query(AgentKey).filter(AgentKey.agent_id == agent_id).delete()
        db.commit()


agent_key_repo = AgentKeyRepo()
