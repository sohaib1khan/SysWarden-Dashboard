"""
config_io.py — Configuration export / import endpoints.

  GET  /config/export        → download a JSON snapshot of all config (admin)
  POST /config/import        → restore config from a JSON snapshot (admin)

What is exported / imported:
  • status_monitors    — all Monitor rows (runtime state excluded)
  • alert_rules        — all AlertRule rows (agent hostname hint included)
  • notification_channels — all NotificationChannel rows
                            (sensitive values masked to "***" on export,
                             "***" values are *skipped* on import so existing
                             credentials are preserved when re-importing)

What is intentionally excluded:
  • agents            — API key hashes are not portable; agents re-register
  • metric data       — time-series, not configuration
  • users             — security concern
  • alert events / incident log — historical data
  • plugin manifests  — auto-discovered by agents, not user-configured
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.v1.auth import _require_admin
from app.db.session import get_db
from app.models.alert import AlertRule
from app.models.monitor import Monitor
from app.models.notification_channel import NotificationChannel
from app.repositories.agent_repo import agent_repo
from app.repositories.alert_repo import alert_rule_repo
from app.repositories.monitor_repo import monitor_repo
from app.repositories.notification_repo import notification_channel_repo

router = APIRouter(prefix="/config", tags=["config-io"])

# ── Sensitive credential keys — masked on export ───────────────────────────────
_SENSITIVE: frozenset[str] = frozenset({"token", "smtp_password"})
_SENTINEL = "***"

EXPORT_VERSION = "1"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _mask_config(cfg: dict) -> dict:
    return {k: (_SENTINEL if k in _SENSITIVE and v else v) for k, v in cfg.items()}


def _parse_config(raw: str) -> dict:
    try:
        return json.loads(raw) if raw else {}
    except Exception:
        return {}


def _agent_hostname(db: Session, agent_id: str) -> str:
    try:
        a = agent_repo.get_by_id(db, agent_id)
        return a.hostname if a else agent_id
    except Exception:
        return agent_id


# ── Export ────────────────────────────────────────────────────────────────────

@router.get("/export")
def export_config(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Return a full JSON snapshot of all configuration.
    Sensitive credentials are replaced with '***'.
    Requires admin.
    """
    _require_admin(authorization, db)

    # ── Monitors ──────────────────────────────────────────────────────────────
    monitors_out = []
    for m in monitor_repo.list_all(db):
        monitors_out.append({
            "name":        m.name,
            "type":        m.type,
            "url":         m.url,
            "port":        m.port,
            "keyword":     m.keyword,
            "method":      m.method,
            "interval_s":  m.interval_s,
            "timeout_s":   m.timeout_s,
            "enabled":     m.enabled,
            "group_name":  m.group_name,
            "sort_order":  m.sort_order,
            "ignore_tls":  m.ignore_tls,
            "cache_buster":m.cache_buster,
            "upside_down": m.upside_down,
            "notify_cert_expiry_days": m.notify_cert_expiry_days,
        })

    # ── Alert rules ───────────────────────────────────────────────────────────
    rules_out = []
    for r in alert_rule_repo.list_all(db):
        rules_out.append({
            "agent_id":      r.agent_id,
            "agent_hostname": _agent_hostname(db, r.agent_id),  # hint for manual mapping
            "metric_name":   r.metric_name,
            "condition":     r.condition,
            "threshold":     r.threshold,
            "duration_s":    r.duration_s,
            "webhook_url":   r.webhook_url,
            "enabled":       r.enabled,
        })

    # ── Notification channels ─────────────────────────────────────────────────
    channels_out = []
    for ch in notification_channel_repo.list_all(db):
        cfg = _parse_config(ch.config)
        channels_out.append({
            "name":                  ch.name,
            "type":                  ch.type,
            "enabled":               ch.enabled,
            "config":                _mask_config(cfg),
            "notify_agent_offline":  ch.notify_agent_offline,
            "notify_agent_online":   ch.notify_agent_online,
            "notify_monitor_down":   ch.notify_monitor_down,
            "notify_monitor_up":     ch.notify_monitor_up,
        })

    payload = {
        "_meta": {
            "version":     EXPORT_VERSION,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "app":         "SysWarden",
        },
        "status_monitors":       monitors_out,
        "alert_rules":           rules_out,
        "notification_channels": channels_out,
    }

    return JSONResponse(
        content=payload,
        headers={
            "Content-Disposition": (
                f'attachment; filename="syswarden-config-'
                f'{datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")}.json"'
            )
        },
    )


# ── Import schemas ─────────────────────────────────────────────────────────────

class MonitorImport(BaseModel):
    name: str
    type: str = "http"
    url: str
    port: Optional[int] = None
    keyword: Optional[str] = None
    method: str = "GET"
    interval_s: int = 60
    timeout_s: int = 10
    enabled: bool = True
    group_name: str = "General"
    sort_order: int = 0
    ignore_tls: bool = False
    cache_buster: bool = False
    upside_down: bool = False
    notify_cert_expiry_days: int = 0


class AlertRuleImport(BaseModel):
    agent_id: str
    agent_hostname: Optional[str] = None  # informational only — ignored
    metric_name: str
    condition: str
    threshold: float
    duration_s: int = 0
    webhook_url: Optional[str] = None
    enabled: bool = True


class ChannelImport(BaseModel):
    name: str
    type: str
    enabled: bool = True
    config: Dict[str, Any] = {}
    notify_agent_offline: bool = True
    notify_agent_online: bool = False
    notify_monitor_down: bool = True
    notify_monitor_up: bool = False


class ImportPayload(BaseModel):
    status_monitors:       List[MonitorImport] = []
    alert_rules:           List[AlertRuleImport] = []
    notification_channels: List[ChannelImport] = []


class ImportResult(BaseModel):
    monitors_created:  int
    monitors_updated:  int
    rules_created:     int
    rules_skipped:     int
    channels_created:  int
    channels_updated:  int
    warnings:          List[str]


# ── Import ────────────────────────────────────────────────────────────────────

_VALID_MONITOR_TYPES   = {"http", "tcp", "keyword"}
_VALID_CONDITIONS      = {"gt", "lt", "gte", "lte"}
_VALID_CHANNEL_TYPES   = {"gotify", "ntfy", "email", "webhook"}


@router.post("/import", response_model=ImportResult, status_code=200)
def import_config(
    payload: ImportPayload,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Merge a config snapshot into the current database.

    Strategy:
      Monitors       — upsert by name (update if exists, create if not)
      Alert rules    — create only; skip if an identical rule already exists for
                       that agent+metric+condition+threshold combination
      Channels       — upsert by name (update config; '***' values are left
                       unchanged so existing credentials are preserved)
    Requires admin.
    """
    _require_admin(authorization, db)

    warnings: List[str] = []
    monitors_created = monitors_updated = 0
    rules_created = rules_skipped = 0
    channels_created = channels_updated = 0

    # ── Monitors ──────────────────────────────────────────────────────────────
    for mi in payload.status_monitors:
        if mi.type not in _VALID_MONITOR_TYPES:
            warnings.append(f"Monitor '{mi.name}': unknown type '{mi.type}' — skipped")
            continue

        existing = (
            db.query(Monitor)
            .filter(Monitor.name == mi.name)
            .first()
        )
        if existing:
            monitor_repo.update(db, existing,
                type=mi.type,
                url=mi.url,
                port=mi.port,
                keyword=mi.keyword,
                method=mi.method,
                interval_s=mi.interval_s,
                timeout_s=mi.timeout_s,
                enabled=mi.enabled,
                group_name=mi.group_name,
                sort_order=mi.sort_order,
                ignore_tls=mi.ignore_tls,
                cache_buster=mi.cache_buster,
                upside_down=mi.upside_down,
                notify_cert_expiry_days=mi.notify_cert_expiry_days,
            )
            monitors_updated += 1
        else:
            monitor_repo.create(
                db,
                name=mi.name,
                type=mi.type,
                url=mi.url,
                port=mi.port,
                keyword=mi.keyword,
                method=mi.method,
                interval_s=mi.interval_s,
                timeout_s=mi.timeout_s,
                group_name=mi.group_name,
                sort_order=mi.sort_order,
                ignore_tls=mi.ignore_tls,
                cache_buster=mi.cache_buster,
                upside_down=mi.upside_down,
                notify_cert_expiry_days=mi.notify_cert_expiry_days,
            )
            monitors_created += 1

    # ── Alert rules ───────────────────────────────────────────────────────────
    for ri in payload.alert_rules:
        if ri.condition not in _VALID_CONDITIONS:
            warnings.append(
                f"Alert rule for agent '{ri.agent_id}' metric '{ri.metric_name}': "
                f"unknown condition '{ri.condition}' — skipped"
            )
            rules_skipped += 1
            continue

        # Verify the referenced agent exists
        if not agent_repo.get_by_id(db, ri.agent_id):
            warnings.append(
                f"Alert rule for agent '{ri.agent_id}' (hostname hint: "
                f"'{ri.agent_hostname or '?'}'): agent not found — skipped. "
                "Re-register the agent and import again."
            )
            rules_skipped += 1
            continue

        # Deduplicate: skip if agent+metric+condition+threshold already present
        duplicate = (
            db.query(AlertRule)
            .filter(
                AlertRule.agent_id    == ri.agent_id,
                AlertRule.metric_name == ri.metric_name,
                AlertRule.condition   == ri.condition,
                AlertRule.threshold   == ri.threshold,
            )
            .first()
        )
        if duplicate:
            rules_skipped += 1
            continue

        alert_rule_repo.create(
            db,
            agent_id=ri.agent_id,
            metric_name=ri.metric_name,
            condition=ri.condition,
            threshold=ri.threshold,
            duration_s=ri.duration_s,
            webhook_url=ri.webhook_url,
            enabled=ri.enabled,
        )
        rules_created += 1

    # ── Notification channels ─────────────────────────────────────────────────
    for ci in payload.notification_channels:
        if ci.type not in _VALID_CHANNEL_TYPES:
            warnings.append(f"Channel '{ci.name}': unknown type '{ci.type}' — skipped")
            continue

        existing_ch = (
            db.query(NotificationChannel)
            .filter(NotificationChannel.name == ci.name)
            .first()
        )

        if existing_ch:
            # Merge config: don't overwrite sensitive fields if the import
            # still contains the masked sentinel.
            existing_cfg = _parse_config(existing_ch.config)
            for k, v in ci.config.items():
                if v == _SENTINEL:
                    continue  # keep existing credential
                existing_cfg[k] = v

            existing_ch.type    = ci.type
            existing_ch.enabled = ci.enabled
            existing_ch.config  = json.dumps(existing_cfg)
            existing_ch.notify_agent_offline = ci.notify_agent_offline
            existing_ch.notify_agent_online  = ci.notify_agent_online
            existing_ch.notify_monitor_down  = ci.notify_monitor_down
            existing_ch.notify_monitor_up    = ci.notify_monitor_up
            db.commit()
            channels_updated += 1
        else:
            # Strip sentinel placeholders before storing (channel would be
            # non-functional anyway, but avoids storing "***" as the token).
            clean_cfg = {k: v for k, v in ci.config.items() if v != _SENTINEL}
            notification_channel_repo.create(
                db,
                name=ci.name,
                type=ci.type,
                enabled=ci.enabled,
                config=json.dumps(clean_cfg),
                notify_agent_offline=ci.notify_agent_offline,
                notify_agent_online=ci.notify_agent_online,
                notify_monitor_down=ci.notify_monitor_down,
                notify_monitor_up=ci.notify_monitor_up,
            )
            channels_created += 1

    return ImportResult(
        monitors_created=monitors_created,
        monitors_updated=monitors_updated,
        rules_created=rules_created,
        rules_skipped=rules_skipped,
        channels_created=channels_created,
        channels_updated=channels_updated,
        warnings=warnings,
    )
