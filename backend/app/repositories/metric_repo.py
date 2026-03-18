from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import asc
from sqlalchemy import distinct as sa_distinct
from sqlalchemy.orm import Session

from app.models.metric import Metric
from app.schemas.metric import MetricPoint


class MetricRepo:
    """All metric DB operations. API routes never call the DB directly."""

    def ingest(
        self, db: Session, agent_id: str, points: List[MetricPoint]
    ) -> int:
        """Bulk-insert metric points. Returns the count inserted."""
        rows = [
            Metric(
                agent_id=agent_id,
                name=p.name,
                value=p.value,
                unit=p.unit,
                timestamp=p.timestamp or datetime.utcnow(),
            )
            for p in points
        ]
        db.add_all(rows)
        db.commit()
        return len(rows)

    def query(
        self,
        db: Session,
        agent_id: str,
        metric_name: str,
        from_ts: Optional[datetime] = None,
        to_ts: Optional[datetime] = None,
        limit: int = 500,
    ) -> List[Metric]:
        q = db.query(Metric).filter(
            Metric.agent_id == agent_id,
            Metric.name == metric_name,
        )
        if from_ts:
            q = q.filter(Metric.timestamp >= from_ts)
        if to_ts:
            q = q.filter(Metric.timestamp <= to_ts)
        return q.order_by(asc(Metric.timestamp)).limit(limit).all()

    def list_names(self, db: Session, agent_id: str) -> List[str]:
        """Return sorted list of distinct metric names stored for this agent."""
        rows = (
            db.query(sa_distinct(Metric.name))
            .filter(Metric.agent_id == agent_id)
            .all()
        )
        return sorted(r[0] for r in rows)

    def latest(
        self, db: Session, agent_id: str, metric_name: str
    ) -> Optional[Metric]:
        return (
            db.query(Metric)
            .filter(Metric.agent_id == agent_id, Metric.name == metric_name)
            .order_by(Metric.timestamp.desc())
            .first()
        )


metric_repo = MetricRepo()
