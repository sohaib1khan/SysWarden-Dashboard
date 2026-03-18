"""
evaluator.py — Alert rule evaluator.

Called on every metric ingest. Checks all enabled rules for the
incoming metric and fires AlertEvents + webhook notifications on breach.

Duration guard:
  Rules with duration_s > 0 only fire after the metric has been
  continuously in breach for that many seconds.  We track the first
  breach timestamp in memory (per rule).  This state is lost on restart —
  acceptable for the current single-process deployment.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Dict, List, Tuple

from app.core import notifier
from app.repositories.alert_repo import alert_event_repo, alert_rule_repo
from app.schemas.metric import MetricPoint

logger = logging.getLogger("evaluator")

# rule_id → datetime the breach started (UTC)
_breach_start: Dict[int, datetime] = {}

_OPS = {
    "gt":  lambda v, t: v > t,
    "lt":  lambda v, t: v < t,
    "gte": lambda v, t: v >= t,
    "lte": lambda v, t: v <= t,
}


def _check(condition: str, value: float, threshold: float) -> bool:
    op = _OPS.get(condition)
    return op(value, threshold) if op else False


async def evaluate(agent_id: str, points: List[MetricPoint]) -> None:
    """
    Evaluate alert rules against a batch of incoming metric points.

    Opens its own short-lived DB session for the synchronous query/write
    phase, closes it before any async HTTP dispatches, then opens a second
    short-lived session to mark events as notified.  This ensures the DB
    connection is never held open across awaits.
    """
    from app.db.session import SessionLocal
    db = SessionLocal()
    # Group points by metric name so we do one DB query per unique name
    by_name: Dict[str, List[MetricPoint]] = {}
    for p in points:
        by_name.setdefault(p.name, []).append(p)

    tasks: List[Tuple] = []
    event_ids_to_notify: List[int] = []

    # ── Phase 1: synchronous DB work (session open only for this block) ───────
    try:
        for metric_name, pts in by_name.items():
            rules = alert_rule_repo.list_enabled_for_metric(db, agent_id, metric_name)
            if not rules:
                continue

            latest_point = max(pts, key=lambda p: p.timestamp or datetime.min)
            value = latest_point.value
            now = datetime.now(timezone.utc).replace(tzinfo=None)

            for rule in rules:
                in_breach = _check(rule.condition, value, rule.threshold)

                if not in_breach:
                    _breach_start.pop(rule.id, None)
                    continue

                if rule.id not in _breach_start:
                    _breach_start[rule.id] = now

                breach_duration = (now - _breach_start[rule.id]).total_seconds()
                if breach_duration < rule.duration_s:
                    continue

                event = alert_event_repo.create(
                    db,
                    rule_id=rule.id,
                    agent_id=agent_id,
                    metric_name=metric_name,
                    value=value,
                    threshold=rule.threshold,
                    condition=rule.condition,
                    fired_at=now,
                    notified=False,
                )
                logger.warning(
                    "ALERT rule=%s agent=%s metric=%s value=%s %s %s",
                    rule.id, agent_id, metric_name, value, rule.condition, rule.threshold,
                )
                _breach_start.pop(rule.id, None)
                tasks.append((rule, event))
                event_ids_to_notify.append(event.id)
    finally:
        db.close()  # release connection BEFORE any async HTTP calls

    if not tasks:
        return

    # ── Phase 2: async HTTP dispatch (no DB session held) ────────────────────
    await asyncio.gather(*[notifier.dispatch(r, e) for r, e in tasks])

    # ── Phase 3: mark events notified (fresh short-lived session) ────────────
    db2 = SessionLocal()
    try:
        for event_id in event_ids_to_notify:
            alert_event_repo.mark_notified(db2, event_id)
    finally:
        db2.close()
