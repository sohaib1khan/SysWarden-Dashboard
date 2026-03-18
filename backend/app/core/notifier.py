"""
notifier.py — Webhook + Web Push notification dispatcher.

Sends a JSON POST to the configured webhook URL when an alert fires.
Works with Slack, Discord, and any generic HTTP webhook.
Also dispatches a Web Push notification to all registered browser subscriptions.
"""
from __future__ import annotations

import asyncio
import json
import logging
import urllib.request
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.alert import AlertEvent, AlertRule

logger = logging.getLogger("notifier")

_CONDITION_LABEL = {"gt": ">", "lt": "<", "gte": "≥", "lte": "≤"}


def _build_payload(rule: "AlertRule", event: "AlertEvent") -> dict:
    op = _CONDITION_LABEL.get(rule.condition, rule.condition)
    text = (
        f"🚨 *SysWarden Alert* — `{event.agent_id}`\n"
        f"Metric `{event.metric_name}` is `{event.value}` "
        f"({op} threshold {rule.threshold})"
    )
    # Slack-compatible envelope; Discord also accepts { "content": ... }
    return {"text": text, "content": text}


def _post_webhook(url: str, payload: dict) -> None:
    """Synchronous HTTP POST — called from a thread so it doesn't block the event loop."""
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            logger.info("webhook delivered (status=%s) rule=%s", resp.status, payload)
    except Exception as exc:
        logger.warning("webhook failed: %s", exc)


async def dispatch(rule: "AlertRule", event: "AlertEvent") -> None:
    """Fire-and-forget webhook + push dispatch. Runs the blocking POST in a thread."""
    loop = asyncio.get_event_loop()

    if rule.webhook_url:
        payload = _build_payload(rule, event)
        await loop.run_in_executor(None, _post_webhook, rule.webhook_url, payload)

    await loop.run_in_executor(None, _send_push_notifications, rule, event)


def _send_push_notifications(rule: "AlertRule", event: "AlertEvent") -> None:
    """Send a Web Push to all registered subscriptions. Runs in a thread pool."""
    try:
        from app.core.vapid import ensure_keys
        from app.db.session import SessionLocal
        from app.models.push_subscription import PushSubscription
        from app.config import settings
    except Exception:
        return

    private_key, public_key = ensure_keys()
    if not private_key:
        return

    db = SessionLocal()
    try:
        subs = db.query(PushSubscription).all()
        if not subs:
            return

        try:
            from pywebpush import webpush, WebPushException  # type: ignore[import]
        except ImportError:
            logger.debug("pywebpush not installed — skipping push notifications")
            return

        op = _CONDITION_LABEL.get(rule.condition, rule.condition)
        push_data = json.dumps({
            "title": f"SysWarden Alert — {event.agent_id}",
            "body": f"{event.metric_name} is {event.value} ({op} {rule.threshold})",
            "agent_id": event.agent_id,
        })

        dead_endpoints: list[str] = []
        for sub in subs:
            try:
                webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=push_data,
                    vapid_private_key=private_key,
                    vapid_claims={"sub": settings.vapid_email},
                )
            except WebPushException as exc:
                if exc.response and exc.response.status_code in (404, 410):
                    # Subscription expired — clean it up
                    dead_endpoints.append(sub.endpoint)
                else:
                    logger.warning("push failed for endpoint %s: %s", sub.endpoint[:40], exc)
            except Exception as exc:
                logger.warning("push error: %s", exc)

        if dead_endpoints:
            db.query(PushSubscription).filter(
                PushSubscription.endpoint.in_(dead_endpoints)
            ).delete(synchronize_session=False)
            db.commit()
    finally:
        db.close()
