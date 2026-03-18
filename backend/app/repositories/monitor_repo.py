from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from app.models.monitor import Monitor, MonitorEvent

# Number of events to keep per monitor before pruning old ones
_MAX_EVENTS = 1_000


class MonitorRepo:
    # ── Monitor CRUD ───────────────────────────────────────────────────────────

    def list_all(self, db: Session, enabled_only: bool = False) -> List[Monitor]:
        q = db.query(Monitor)
        if enabled_only:
            q = q.filter_by(enabled=True)
        return q.order_by(Monitor.group_name, Monitor.sort_order, Monitor.name).all()

    def get_by_id(self, db: Session, monitor_id: int) -> Optional[Monitor]:
        return db.get(Monitor, monitor_id)

    def create(
        self,
        db: Session,
        name: str,
        type: str,
        url: str,
        port: Optional[int],
        keyword: Optional[str],
        method: str,
        interval_s: int,
        timeout_s: int,
        group_name: str = "General",
        sort_order: int = 0,
        ignore_tls: bool = False,
        cache_buster: bool = False,
        upside_down: bool = False,
        notify_cert_expiry_days: int = 0,
    ) -> Monitor:
        monitor = Monitor(
            name=name,
            type=type,
            url=url,
            port=port,
            keyword=keyword,
            method=method,
            interval_s=interval_s,
            timeout_s=timeout_s,
            group_name=group_name,
            sort_order=sort_order,
            ignore_tls=ignore_tls,
            cache_buster=cache_buster,
            upside_down=upside_down,
            notify_cert_expiry_days=notify_cert_expiry_days,
        )
        db.add(monitor)
        db.commit()
        db.refresh(monitor)
        return monitor

    def update(self, db: Session, monitor: Monitor, **fields) -> Monitor:
        for k, v in fields.items():
            setattr(monitor, k, v)
        db.commit()
        db.refresh(monitor)
        return monitor

    def bulk_reorder(self, db: Session, items: List[tuple]) -> None:
        """items: list of (id, sort_order, group_name)"""
        for monitor_id, sort_order, group_name in items:
            m = db.get(Monitor, monitor_id)
            if m:
                m.sort_order = sort_order
                m.group_name = group_name
        db.commit()

    def set_enabled(self, db: Session, monitor: Monitor, enabled: bool) -> Monitor:
        monitor.enabled = enabled
        monitor.status = "paused" if not enabled else (monitor.status if monitor.status != "paused" else "unknown")
        db.commit()
        db.refresh(monitor)
        return monitor

    def delete(self, db: Session, monitor: Monitor) -> None:
        db.delete(monitor)
        db.commit()

    def update_status(
        self,
        db: Session,
        monitor: Monitor,
        status: str,
        response_time_ms: Optional[float],
        consecutive_failures: int = 0,
    ) -> Monitor:
        monitor.status = status
        monitor.last_checked = datetime.utcnow()
        monitor.response_time_ms = response_time_ms
        monitor.consecutive_failures = consecutive_failures
        db.commit()
        db.refresh(monitor)
        return monitor

    # ── Monitor events ─────────────────────────────────────────────────────────

    def list_events(
        self, db: Session, monitor_id: int, limit: int = 90
    ) -> List[MonitorEvent]:
        """Return the most-recent `limit` events, oldest first (for bar rendering)."""
        subq = (
            db.query(MonitorEvent)
            .filter_by(monitor_id=monitor_id)
            .order_by(MonitorEvent.checked_at.desc())
            .limit(limit)
            .subquery()
        )
        from sqlalchemy import select
        rows = db.execute(
            select(MonitorEvent)
            .where(MonitorEvent.id.in_(select(subq.c.id)))
            .order_by(MonitorEvent.checked_at.asc())
        ).scalars().all()
        return rows

    def create_event(
        self,
        db: Session,
        monitor_id: int,
        status: str,
        response_time_ms: Optional[float],
        error_msg: Optional[str],
    ) -> MonitorEvent:
        event = MonitorEvent(
            monitor_id=monitor_id,
            status=status,
            response_time_ms=response_time_ms,
            error_msg=error_msg,
        )
        db.add(event)
        db.flush()

        # Prune old events to keep the table bounded
        oldest_keep = (
            db.query(MonitorEvent)
            .filter_by(monitor_id=monitor_id)
            .order_by(MonitorEvent.checked_at.desc())
            .offset(_MAX_EVENTS - 1)
            .first()
        )
        if oldest_keep:
            db.query(MonitorEvent).filter(
                MonitorEvent.monitor_id == monitor_id,
                MonitorEvent.checked_at < oldest_keep.checked_at,
            ).delete(synchronize_session=False)

        db.commit()
        db.refresh(event)
        return event

    def uptime_percent(self, db: Session, monitor_id: int, sample: int = 90) -> float:
        """Return 0–100 uptime % across the last `sample` events."""
        events = (
            db.query(MonitorEvent)
            .filter_by(monitor_id=monitor_id)
            .order_by(MonitorEvent.checked_at.desc())
            .limit(sample)
            .all()
        )
        if not events:
            return 0.0
        up = sum(1 for e in events if e.status == "up")
        return round(up / len(events) * 100, 2)


monitor_repo = MonitorRepo()
