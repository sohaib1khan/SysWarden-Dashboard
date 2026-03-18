from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.agent import Agent


class AgentRepo:
    """All agent DB operations. API routes never call the DB directly."""

    def get_by_id(self, db: Session, agent_id: str) -> Optional[Agent]:
        return db.get(Agent, agent_id)

    def list_all(self, db: Session) -> List[Agent]:
        return db.query(Agent).order_by(Agent.registered_at.desc()).all()

    def create(
        self,
        db: Session,
        agent_id: str,
        hostname: str,
        api_key_hash: str,
        capabilities: List[str],
    ) -> Agent:
        agent = Agent(
            id=agent_id,
            hostname=hostname,
            api_key_hash=api_key_hash,
            capabilities=",".join(capabilities),
            registered_at=datetime.utcnow(),
            online=True,
        )
        db.add(agent)
        db.commit()
        db.refresh(agent)
        return agent

    def get_by_hostname(self, db: Session, hostname: str) -> Optional[Agent]:
        return db.query(Agent).filter(Agent.hostname == hostname).first()

    def update_api_key(self, db: Session, agent_id: str, key_hash: str) -> Optional[Agent]:
        """Replace the API key hash for an existing agent (key rotation on re-register)."""
        agent = self.get_by_id(db, agent_id)
        if not agent:
            return None
        agent.api_key_hash = key_hash
        agent.last_seen = datetime.utcnow()
        agent.online = True
        db.commit()
        db.refresh(agent)
        return agent

    def update_last_seen(self, db: Session, agent_id: str) -> None:
        agent = self.get_by_id(db, agent_id)
        if agent:
            agent.last_seen = datetime.utcnow()
            agent.online = True
            db.commit()

    def set_offline(self, db: Session, agent_id: str) -> None:
        agent = self.get_by_id(db, agent_id)
        if agent:
            agent.online = False
            db.commit()

    def rename(self, db: Session, agent_id: str, new_hostname: str) -> Optional[Agent]:
        agent = self.get_by_id(db, agent_id)
        if not agent:
            return None
        agent.hostname = new_hostname
        db.commit()
        db.refresh(agent)
        return agent

    def delete(self, db: Session, agent_id: str) -> bool:
        agent = self.get_by_id(db, agent_id)
        if not agent:
            return False
        db.delete(agent)
        db.commit()
        return True

    def update_capabilities(self, db: Session, agent_id: str, capabilities: list) -> None:
        agent = self.get_by_id(db, agent_id)
        if agent:
            agent.capabilities = ",".join(capabilities)
            db.commit()


agent_repo = AgentRepo()
