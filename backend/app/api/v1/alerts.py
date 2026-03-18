from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.repositories.alert_repo import alert_event_repo, alert_rule_repo
from app.repositories.agent_repo import agent_repo
from app.schemas.alert import AlertEventOut, AlertRuleCreate, AlertRuleOut

router = APIRouter(tags=["alerts"])


# ── Rules ──────────────────────────────────────────────────────────────────────

@router.post("/alerts/rules", response_model=AlertRuleOut, status_code=201)
def create_rule(
    payload: AlertRuleCreate,
    db: Session = Depends(get_db),
):
    """Create a new alert rule for an agent metric."""
    if not agent_repo.get_by_id(db, payload.agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    rule = alert_rule_repo.create(db, **payload.model_dump())
    return rule


@router.get("/alerts/rules", response_model=List[AlertRuleOut])
def list_rules(
    agent_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all alert rules, optionally filtered by agent."""
    if agent_id:
        return alert_rule_repo.list_for_agent(db, agent_id)
    return alert_rule_repo.list_all(db)


@router.patch("/alerts/rules/{rule_id}", response_model=AlertRuleOut)
def toggle_rule(
    rule_id: int,
    enabled: bool,
    db: Session = Depends(get_db),
):
    """Enable or disable a rule."""
    rule = alert_rule_repo.update_enabled(db, rule_id, enabled)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule


@router.delete("/alerts/rules/{rule_id}", status_code=204)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
):
    """Delete an alert rule."""
    if not alert_rule_repo.delete(db, rule_id):
        raise HTTPException(status_code=404, detail="Rule not found")


# ── Events (incident log) ──────────────────────────────────────────────────────

@router.get("/alerts/events", response_model=List[AlertEventOut])
def list_events(
    agent_id: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    """Retrieve the most recent alert events (incident log)."""
    return alert_event_repo.list_recent(db, limit=min(limit, 500), agent_id=agent_id)
