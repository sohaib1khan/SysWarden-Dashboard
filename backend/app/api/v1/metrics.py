from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy.orm import Session

from app.core import security
from app.db.session import get_db
from app.repositories.agent_repo import agent_repo
from app.repositories.metric_repo import metric_repo
from app.schemas.metric import MetricIngestRequest, MetricResponse

router = APIRouter(tags=["metrics"])


def _authenticate_agent(
    agent_id: str,
    x_api_key: str,
    db: Session,
):
    """Look up agent and verify API key. Raises 401 on any failure."""
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent or not security.verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return agent


@router.post("/metrics", status_code=202)
def ingest_metrics(
    payload: MetricIngestRequest,
    x_api_key: str = Header(..., alias="X-Api-Key"),
    db: Session = Depends(get_db),
):
    """Receive a batch of metric points from an agent."""
    agent = _authenticate_agent(payload.agent_id, x_api_key, db)
    count = metric_repo.ingest(db, agent.id, payload.metrics)
    agent_repo.update_last_seen(db, agent.id)
    return {"accepted": count}


@router.get("/metrics/{agent_id}/names", response_model=list[str])
def list_metric_names(
    agent_id: str,
    db: Session = Depends(get_db),
):
    """Return all distinct metric names stored for this agent."""
    if not agent_repo.get_by_id(db, agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return metric_repo.list_names(db, agent_id)


@router.get("/metrics/{agent_id}", response_model=list[MetricResponse])
def query_metrics(
    agent_id: str,
    metric: str = Query(..., min_length=1, max_length=64),
    from_ts: Optional[datetime] = Query(None, alias="from"),
    to_ts: Optional[datetime] = Query(None, alias="to"),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """Query stored metric data for a given agent + metric name."""
    if not agent_repo.get_by_id(db, agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return metric_repo.query(db, agent_id, metric, from_ts, to_ts, limit)
