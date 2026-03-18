"""
push.py — Web Push / VAPID notification endpoints.

Routes:
  GET  /push/vapid-public-key        → returns VAPID public key for browser subscription
  POST /push/subscribe               → register / refresh a push subscription
  DELETE /push/subscribe             → remove a subscription by endpoint
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, HttpUrl
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.vapid import ensure_keys
from app.db.session import get_db
from app.models.push_subscription import PushSubscription

logger = logging.getLogger("push")
router = APIRouter(prefix="/push", tags=["push"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class PushKeys(BaseModel):
    p256dh: str
    auth: str


class SubscribeRequest(BaseModel):
    endpoint: str
    keys: PushKeys


class UnsubscribeRequest(BaseModel):
    endpoint: str


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/vapid-public-key")
def get_vapid_public_key():
    """Return the VAPID application server public key (base64url encoded)."""
    _, public_key = ensure_keys()
    if not public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications not configured",
        )
    return {"publicKey": public_key}


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: SubscribeRequest, db: Session = Depends(get_db)):
    """Register or refresh a Web Push subscription."""
    _, public_key = ensure_keys()
    if not public_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Push notifications not configured",
        )

    # Upsert — endpoint is unique, so just delete-then-insert
    db.query(PushSubscription).filter_by(endpoint=body.endpoint).delete()
    sub = PushSubscription(
        endpoint=body.endpoint,
        p256dh=body.keys.p256dh,
        auth=body.keys.auth,
    )
    db.add(sub)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subscription conflict")


@router.delete("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: UnsubscribeRequest, db: Session = Depends(get_db)):
    """Remove a push subscription by endpoint URL."""
    db.query(PushSubscription).filter_by(endpoint=body.endpoint).delete()
    db.commit()
