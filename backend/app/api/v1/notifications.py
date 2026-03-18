"""
notifications.py — Notification channel CRUD + test endpoints.

  GET    /notifications/channels          → list all channels
  POST   /notifications/channels          → create a channel (admin)
  PATCH  /notifications/channels/{id}     → update a channel (admin)
  DELETE /notifications/channels/{id}     → delete a channel (admin)
  POST   /notifications/channels/{id}/test → send a test notification (admin)
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import _require_admin, _resolve_user
from app.db.session import get_db
from app.repositories.notification_repo import notification_channel_repo

router = APIRouter(prefix="/notifications", tags=["notifications"])

# ── Schemas ────────────────────────────────────────────────────────────────────

class ChannelCreate(BaseModel):
    name: str
    type: str  # gotify | ntfy | email | webhook
    enabled: bool = True
    config: Dict[str, Any] = {}
    notify_agent_offline: bool = True
    notify_agent_online: bool = False
    notify_monitor_down: bool = True
    notify_monitor_up: bool = False


class ChannelUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    config: Optional[Dict[str, Any]] = None
    notify_agent_offline: Optional[bool] = None
    notify_agent_online: Optional[bool] = None
    notify_monitor_down: Optional[bool] = None
    notify_monitor_up: Optional[bool] = None


_SENSITIVE = {"smtp_password", "token"}

def _mask(cfg: dict) -> dict:
    """Replace sensitive values with '***' in responses."""
    return {k: ("***" if k in _SENSITIVE and v else v) for k, v in cfg.items()}

def _channel_out(ch) -> dict:
    try:
        cfg = json.loads(ch.config) if ch.config else {}
    except Exception:
        cfg = {}
    return {
        "id": ch.id,
        "name": ch.name,
        "type": ch.type,
        "enabled": ch.enabled,
        "config": _mask(cfg),
        "notify_agent_offline": ch.notify_agent_offline,
        "notify_agent_online": ch.notify_agent_online,
        "notify_monitor_down": ch.notify_monitor_down,
        "notify_monitor_up": ch.notify_monitor_up,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }

_VALID_TYPES = {"gotify", "ntfy", "email", "webhook"}

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/channels")
def list_channels(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)  # any authenticated user can read
    channels = notification_channel_repo.list_all(db)
    return [_channel_out(ch) for ch in channels]


@router.post("/channels", status_code=201)
def create_channel(
    payload: ChannelCreate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    if payload.type not in _VALID_TYPES:
        raise HTTPException(status_code=422, detail=f"type must be one of {sorted(_VALID_TYPES)}")
    ch = notification_channel_repo.create(
        db,
        name=payload.name,
        type=payload.type,
        enabled=payload.enabled,
        config=json.dumps(payload.config),
        notify_agent_offline=payload.notify_agent_offline,
        notify_agent_online=payload.notify_agent_online,
        notify_monitor_down=payload.notify_monitor_down,
        notify_monitor_up=payload.notify_monitor_up,
    )
    return _channel_out(ch)


@router.patch("/channels/{channel_id}")
def update_channel(
    channel_id: int,
    payload: ChannelUpdate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    ch = notification_channel_repo.get_by_id(db, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    updates: dict = {}
    if payload.name is not None:
        updates["name"] = payload.name
    if payload.enabled is not None:
        updates["enabled"] = payload.enabled
    if payload.notify_agent_offline is not None:
        updates["notify_agent_offline"] = payload.notify_agent_offline
    if payload.notify_agent_online is not None:
        updates["notify_agent_online"] = payload.notify_agent_online
    if payload.notify_monitor_down is not None:
        updates["notify_monitor_down"] = payload.notify_monitor_down
    if payload.notify_monitor_up is not None:
        updates["notify_monitor_up"] = payload.notify_monitor_up
    if payload.config is not None:
        # Merge: keep existing sensitive fields if the user sent '***'
        try:
            existing_cfg = json.loads(ch.config) if ch.config else {}
        except Exception:
            existing_cfg = {}
        merged = {**existing_cfg, **payload.config}
        # Restore originals for any field that was left as '***'
        for k in _SENSITIVE:
            if merged.get(k) == "***":
                merged[k] = existing_cfg.get(k, "")
        updates["config"] = json.dumps(merged)

    ch = notification_channel_repo.update(db, channel_id, **updates)
    return _channel_out(ch)


@router.delete("/channels/{channel_id}", status_code=204)
def delete_channel(
    channel_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    if not notification_channel_repo.delete(db, channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")


@router.post("/channels/{channel_id}/test")
def test_channel(
    channel_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    ch = notification_channel_repo.get_by_id(db, channel_id)
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    from app.core.channel_notifier import send_to_channel
    import asyncio

    try:
        cfg = json.loads(ch.config) if ch.config else {}
    except Exception:
        cfg = {}

    result = asyncio.get_event_loop().run_in_executor(
        None,
        lambda: send_to_channel(ch.type, cfg, "🔔 SysWarden Test", "This is a test notification from SysWarden."),
    )
    # Fire-and-forget — we don't await here, just confirm the request was accepted
    return {"status": "sent", "channel": ch.name}
