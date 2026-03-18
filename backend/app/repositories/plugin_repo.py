from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.plugin import Plugin


class PluginRepo:
    def list_all(self, db: Session, agent_id: str | None = None) -> List[Plugin]:
        q = db.query(Plugin)
        if agent_id:
            q = q.filter_by(agent_id=agent_id)
        return q.order_by(Plugin.agent_id, Plugin.name).all()

    def get_by_id(self, db: Session, plugin_id: int) -> Optional[Plugin]:
        return db.get(Plugin, plugin_id)

    def get_by_agent_and_name(self, db: Session, agent_id: str, name: str) -> Optional[Plugin]:
        return db.query(Plugin).filter_by(agent_id=agent_id, name=name).first()

    def upsert(
        self,
        db: Session,
        agent_id: str,
        name: str,
        version: str,
        description: str,
        author: str,
        interval_seconds: int,
        output_schema: str,
    ) -> Plugin:
        existing = self.get_by_agent_and_name(db, agent_id, name)
        if existing:
            existing.version = version
            existing.description = description
            existing.author = author
            existing.interval_seconds = interval_seconds
            existing.output_schema = output_schema
            existing.last_seen = datetime.utcnow()
            db.commit()
            db.refresh(existing)
            return existing
        plugin = Plugin(
            agent_id=agent_id,
            name=name,
            version=version,
            description=description,
            author=author,
            interval_seconds=interval_seconds,
            output_schema=output_schema,
            last_seen=datetime.utcnow(),
        )
        db.add(plugin)
        db.commit()
        db.refresh(plugin)
        return plugin

    def set_enabled(self, db: Session, plugin_id: int, enabled: bool) -> Optional[Plugin]:
        plugin = self.get_by_id(db, plugin_id)
        if not plugin:
            return None
        plugin.enabled = enabled
        db.commit()
        db.refresh(plugin)
        return plugin

    def delete(self, db: Session, plugin_id: int) -> None:
        db.query(Plugin).filter_by(id=plugin_id).delete()
        db.commit()

    def touch(self, db: Session, agent_id: str, name: str) -> None:
        """Update last_seen to now — called when a plugin successfully runs."""
        plugin = self.get_by_agent_and_name(db, agent_id, name)
        if plugin:
            plugin.last_seen = datetime.utcnow()
            db.commit()


plugin_repo = PluginRepo()
