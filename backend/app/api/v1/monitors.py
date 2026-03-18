from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.api.v1.auth import _resolve_user, _require_admin
from app.db.session import get_db
from app.models.monitor import Monitor, MonitorEvent
from app.repositories.monitor_repo import monitor_repo

router = APIRouter(tags=["monitors"])

# ── Schemas ────────────────────────────────────────────────────────────────────

class MonitorCreate(BaseModel):
    name: str
    type: Literal["http", "tcp", "keyword"] = "http"
    url: str
    port: Optional[int] = None
    keyword: Optional[str] = None
    method: Literal["GET", "HEAD"] = "GET"
    interval_s: int = 60
    timeout_s: int = 10
    group_name: str = "General"
    sort_order: int = 0
    # Advanced options
    ignore_tls: bool = False
    cache_buster: bool = False
    upside_down: bool = False
    notify_cert_expiry_days: int = 0

    @field_validator("url")
    @classmethod
    def _url_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("url must not be empty")
        return v

    @field_validator("interval_s")
    @classmethod
    def _interval_ge_10(cls, v: int) -> int:
        if v < 10:
            raise ValueError("interval_s must be at least 10 seconds")
        return v

    @field_validator("timeout_s")
    @classmethod
    def _timeout_ge_1(cls, v: int) -> int:
        if v < 1:
            raise ValueError("timeout_s must be at least 1 second")
        return v


class MonitorUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    port: Optional[int] = None
    keyword: Optional[str] = None
    method: Optional[Literal["GET", "HEAD"]] = None
    interval_s: Optional[int] = None
    timeout_s: Optional[int] = None
    enabled: Optional[bool] = None
    group_name: Optional[str] = None
    sort_order: Optional[int] = None
    # Advanced options
    ignore_tls: Optional[bool] = None
    cache_buster: Optional[bool] = None
    upside_down: Optional[bool] = None
    notify_cert_expiry_days: Optional[int] = None


class ReorderItem(BaseModel):
    id: int
    sort_order: int
    group_name: str


class MonitorEventOut(BaseModel):
    id: int
    status: str
    response_time_ms: Optional[float]
    error_msg: Optional[str]
    checked_at: datetime

    model_config = {"from_attributes": True}


class MonitorOut(BaseModel):
    id: int
    name: str
    type: str
    url: str
    port: Optional[int]
    keyword: Optional[str]
    method: str
    interval_s: int
    timeout_s: int
    enabled: bool
    status: str
    last_checked: Optional[datetime]
    response_time_ms: Optional[float]
    uptime_percent: float
    created_at: datetime
    group_name: str
    sort_order: int
    # Advanced options
    ignore_tls: bool
    cache_buster: bool
    upside_down: bool
    notify_cert_expiry_days: int

    model_config = {"from_attributes": True}


def _enrich(db: Session, m: Monitor) -> dict:
    """Attach uptime_percent to the monitor dict."""
    d = {c.name: getattr(m, c.name) for c in m.__table__.columns}
    d["uptime_percent"] = monitor_repo.uptime_percent(db, m.id)
    return d


# ── Routes ─────────────────────────────────────────────────────────────────────

@router.get("/monitors", response_model=List[MonitorOut])
def list_monitors(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    monitors = monitor_repo.list_all(db)
    return [_enrich(db, m) for m in monitors]


@router.post("/monitors", response_model=MonitorOut, status_code=201)
def create_monitor(
    payload: MonitorCreate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    m = monitor_repo.create(
        db,
        name=payload.name,
        type=payload.type,
        url=payload.url,
        port=payload.port,
        keyword=payload.keyword,
        method=payload.method,
        interval_s=payload.interval_s,
        timeout_s=payload.timeout_s,
        group_name=payload.group_name,
        sort_order=payload.sort_order,
        ignore_tls=payload.ignore_tls,
        cache_buster=payload.cache_buster,
        upside_down=payload.upside_down,
        notify_cert_expiry_days=payload.notify_cert_expiry_days,
    )
    return _enrich(db, m)


@router.get("/monitors/{monitor_id}", response_model=MonitorOut)
def get_monitor(
    monitor_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    m = monitor_repo.get_by_id(db, monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return _enrich(db, m)


@router.patch("/monitors/{monitor_id}", response_model=MonitorOut)
def update_monitor(
    monitor_id: int,
    payload: MonitorUpdate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    m = monitor_repo.get_by_id(db, monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")

    updates = payload.model_dump(exclude_none=True)

    # Handle enabled toggle separately (it also updates status)
    if "enabled" in updates:
        enabled = updates.pop("enabled")
        monitor_repo.set_enabled(db, m, enabled)

    if updates:
        monitor_repo.update(db, m, **updates)

    return _enrich(db, m)


@router.delete("/monitors/{monitor_id}", status_code=204)
def delete_monitor(
    monitor_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    m = monitor_repo.get_by_id(db, monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    monitor_repo.delete(db, m)


@router.post("/monitors/reorder", status_code=204)
def reorder_monitors(
    items: List[ReorderItem],
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    monitor_repo.bulk_reorder(db, [(i.id, i.sort_order, i.group_name) for i in items])


@router.get("/monitors/{monitor_id}/events", response_model=List[MonitorEventOut])
def get_events(
    monitor_id: int,
    limit: int = 90,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    m = monitor_repo.get_by_id(db, monitor_id)
    if not m:
        raise HTTPException(status_code=404, detail="Monitor not found")
    return monitor_repo.list_events(db, monitor_id, limit=min(limit, 500))
