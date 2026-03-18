"""
channel_notifier.py — Multi-channel notification dispatcher.

Supported channels:
  gotify  — POST {url}/message?token={token}
  ntfy    — POST {url}/{topic}  (plain text body, Title/Priority headers)
  email   — SMTP with STARTTLS or SSL (smtplib — stdlib, no extra dep)
  webhook — Generic HTTP POST with JSON body

Public API:
  await dispatch_event(event_type, title, body)
      → loads all enabled channels subscribed to event_type from DB
        and fires each one concurrently in the thread pool.

  send_to_channel(ch_type, cfg, title, body)   [sync, for test endpoint]
      → sends to a single channel and raises on failure.
"""
from __future__ import annotations

import asyncio
import json
import logging
import smtplib
import ssl
from email.message import EmailMessage
from typing import Any, Dict

import httpx

logger = logging.getLogger("channel_notifier")


# ── Per-channel send functions (synchronous, run in thread pool) ──────────────

def _send_gotify(cfg: Dict[str, Any], title: str, body: str) -> None:
    url = cfg.get("url", "").rstrip("/")
    token = cfg.get("token", "")
    priority = int(cfg.get("priority", 5))
    if not url or not token:
        raise ValueError("gotify requires 'url' and 'token'")
    endpoint = f"{url}/message?token={token}"
    payload = {"title": title, "message": body, "priority": priority}
    with httpx.Client(timeout=10, verify=False) as client:
        resp = client.post(endpoint, json=payload)
        resp.raise_for_status()


def _send_ntfy(cfg: Dict[str, Any], title: str, body: str) -> None:
    url = cfg.get("url", "").rstrip("/")
    topic = cfg.get("topic", "")
    priority = cfg.get("priority", "default")
    if not url or not topic:
        raise ValueError("ntfy requires 'url' and 'topic'")
    endpoint = f"{url}/{topic}"
    headers = {
        "Title": title,
        "Priority": str(priority),
        "Tags": "bell,syswarden",
        "Content-Type": "text/plain; charset=utf-8",
    }
    with httpx.Client(timeout=10, verify=False) as client:
        resp = client.post(endpoint, content=body.encode(), headers=headers)
        resp.raise_for_status()


def _send_email(cfg: Dict[str, Any], title: str, body: str) -> None:
    host = cfg.get("smtp_host", "")
    port = int(cfg.get("smtp_port", 587))
    user = cfg.get("smtp_user", "")
    password = cfg.get("smtp_password", "")
    use_tls = bool(cfg.get("smtp_tls", True))
    from_addr = cfg.get("from_addr", user)
    to_raw = cfg.get("to_addrs", "")
    to_addrs = [a.strip() for a in to_raw.split(",") if a.strip()]

    if not host or not to_addrs:
        raise ValueError("email requires 'smtp_host' and 'to_addrs'")

    msg = EmailMessage()
    msg["Subject"] = title
    msg["From"] = from_addr
    msg["To"] = ", ".join(to_addrs)
    msg.set_content(body)

    ctx = ssl.create_default_context()
    if port == 465:
        # SMTP_SSL
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=15) as smtp:
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)
    else:
        # STARTTLS (587, 25)
        with smtplib.SMTP(host, port, timeout=15) as smtp:
            if use_tls:
                smtp.starttls(context=ctx)
            if user and password:
                smtp.login(user, password)
            smtp.send_message(msg)


def _send_webhook(cfg: Dict[str, Any], title: str, body: str) -> None:
    url = cfg.get("url", "")
    extra_headers = cfg.get("headers") or {}
    if not url:
        raise ValueError("webhook requires 'url'")
    payload = {"title": title, "message": body, "source": "syswarden"}
    headers = {"Content-Type": "application/json", **extra_headers}
    with httpx.Client(timeout=10, verify=False) as client:
        resp = client.post(url, json=payload, headers=headers)
        resp.raise_for_status()


_SENDERS = {
    "gotify":  _send_gotify,
    "ntfy":    _send_ntfy,
    "email":   _send_email,
    "webhook": _send_webhook,
}


def send_to_channel(ch_type: str, cfg: Dict[str, Any], title: str, body: str) -> None:
    """Send through a single channel. Raises on failure (used by test endpoint)."""
    sender = _SENDERS.get(ch_type)
    if not sender:
        raise ValueError(f"Unknown channel type: {ch_type}")
    sender(cfg, title, body)


# ── Public async dispatcher ───────────────────────────────────────────────────

async def dispatch_event(event_type: str, title: str, body: str) -> None:
    """
    Load all enabled channels subscribed to `event_type` and fire each
    concurrently in the thread pool.

    event_type: 'agent_offline' | 'agent_online' | 'monitor_down' | 'monitor_up'
    """
    try:
        from app.db.session import SessionLocal
        from app.repositories.notification_repo import notification_channel_repo

        db = SessionLocal()
        try:
            channels = notification_channel_repo.list_enabled_for_event(db, event_type)
            if not channels:
                return
            # Snapshot config while in DB session
            targets = []
            for ch in channels:
                try:
                    cfg = json.loads(ch.config) if ch.config else {}
                except Exception:
                    cfg = {}
                targets.append((ch.type, cfg, ch.name))
        finally:
            db.close()
    except Exception as exc:
        logger.error("channel_notifier: failed to load channels: %s", exc)
        return

    loop = asyncio.get_event_loop()

    async def _fire(ch_type: str, cfg: dict, ch_name: str) -> None:
        try:
            await loop.run_in_executor(
                None, send_to_channel, ch_type, cfg, title, body
            )
            logger.info("notification sent via %s (%s) for event=%s", ch_type, ch_name, event_type)
        except Exception as exc:
            logger.warning(
                "notification failed via %s (%s) for event=%s: %s",
                ch_type, ch_name, event_type, exc,
            )

    await asyncio.gather(*[_fire(t, c, n) for t, c, n in targets])
