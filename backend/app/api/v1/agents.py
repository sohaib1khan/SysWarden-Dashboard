from __future__ import annotations

import asyncio
import time as _time
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Body, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core import security
from app.core.relay import broker
from app.db.session import get_db
from app.repositories.agent_key_repo import agent_key_repo
from app.repositories.agent_repo import agent_repo
from app.schemas.agent import AgentInfo, AgentRegisterRequest, AgentRegisterResponse
from app.api.v1.auth import _resolve_user

router = APIRouter(tags=["agents"])


# ── Key management schemas ────────────────────────────────────────────────────

class SaveKeyRequest(BaseModel):
    key: str = Field(min_length=1, max_length=256)
    label: str = Field(default="default", min_length=1, max_length=128)


class AgentKeyOut(BaseModel):
    id: int
    agent_id: str
    label: str
    key_preview: str        # first 6 chars + "…" — never expose full key
    created_at: datetime
    verified_at: Optional[datetime]

    model_config = {"from_attributes": True}


def _to_key_out(row) -> AgentKeyOut:
    preview = row.key_value[:6] + "…" if len(row.key_value) > 6 else "…"
    return AgentKeyOut(
        id=row.id,
        agent_id=row.agent_id,
        label=row.label,
        key_preview=preview,
        created_at=row.created_at,
        verified_at=row.verified_at,
    )


@router.post("/agents/register", response_model=AgentRegisterResponse, status_code=201)
def register_agent(
    payload: AgentRegisterRequest,
    db: Session = Depends(get_db),
):
    """
    Register or re-register an agent.

    Same hostname → same agent_id (key rotated, no duplicate row created).
    New hostname  → new agent_id.

    This makes registration idempotent: reboots, keyfile loss, and DB restores
    never accumulate duplicate entries for the same machine.
    """
    raw_key, key_hash = security.generate_api_key()

    existing = agent_repo.get_by_hostname(db, payload.hostname)
    if existing:
        # Known host — rotate its key and return the existing agent_id
        agent_repo.update_api_key(db, existing.id, key_hash)
        return AgentRegisterResponse(agent_id=existing.id, api_key=raw_key)

    # Genuinely new hostname — create a fresh agent row
    agent_id = security.generate_agent_id()
    agent_repo.create(
        db,
        agent_id=agent_id,
        hostname=payload.hostname,
        api_key_hash=key_hash,
        capabilities=payload.capabilities,
    )
    return AgentRegisterResponse(agent_id=agent_id, api_key=raw_key)


@router.get("/agents", response_model=list[AgentInfo])
def list_agents(db: Session = Depends(get_db)):
    """Return all registered agents with their current online status."""
    return agent_repo.list_all(db)


@router.get("/agents/{agent_id}", response_model=AgentInfo)
def get_agent(agent_id: str, db: Session = Depends(get_db)):
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    return agent


@router.patch("/agents/{agent_id}", response_model=AgentInfo)
def rename_agent(
    agent_id: str,
    hostname: str = Body(..., embed=True, min_length=1, max_length=128),
    x_api_key: str = Header(..., alias="X-Api-Key"),
    db: Session = Depends(get_db),
):
    """Rename an agent's hostname label — requires the agent's API key."""
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent or not security.verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return agent_repo.rename(db, agent_id, hostname)


class _UpdateCapabilitiesRequest(BaseModel):
    capabilities: list[str]


@router.patch("/agents/{agent_id}/capabilities", status_code=204)
def update_agent_capabilities(
    agent_id: str,
    body: _UpdateCapabilitiesRequest,
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Called by the agent loader after dynamically registering new capability plugins."""
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent or not x_api_key or not security.verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Unauthorized")
    agent_repo.update_capabilities(db, agent_id, body.capabilities)


@router.get("/agents/{agent_id}/ping")
def ping_agent(agent_id: str, db: Session = Depends(get_db)):
    """
    Lightweight reachability check — no auth required.
    Returns whether the agent has an active WebSocket connection and
    how many seconds ago it last sent a heartbeat.
    """
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    connected = broker.get(agent_id) is not None
    last_seen_s: int | None = None
    if agent.last_seen:
        last_seen_s = max(0, int((datetime.utcnow() - agent.last_seen).total_seconds()))

    return {
        "online": agent.online,
        "connected": connected,
        "last_seen_s": last_seen_s,
    }


@router.delete("/agents/{agent_id}", status_code=204)
def remove_agent(
    agent_id: str,
    db: Session = Depends(get_db),
):
    """Remove an agent and all its data."""
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    agent_repo.delete(db, agent_id)


# ── Agent key management (server-side persistence) ───────────────────────────

@router.get("/agents/{agent_id}/keys", response_model=list[AgentKeyOut])
def list_agent_keys(
    agent_id: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """List all saved API keys for an agent. Requires user auth."""
    _resolve_user(authorization, db)
    if not agent_repo.get_by_id(db, agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    return [_to_key_out(r) for r in agent_key_repo.list_for_agent(db, agent_id)]


@router.post("/agents/{agent_id}/keys", response_model=AgentKeyOut, status_code=201)
def save_agent_key(
    agent_id: str,
    body: SaveKeyRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Save (or replace) an API key for an agent. Requires user auth."""
    _resolve_user(authorization, db)
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    # Verify the key is correct before saving it
    if not security.verify_api_key(body.key, agent.api_key_hash):
        raise HTTPException(status_code=422, detail="Key does not match agent — verify it with Test first")
    row = agent_key_repo.upsert(db, agent_id, body.key, body.label)
    agent_key_repo.mark_verified(db, row.id)
    return _to_key_out(row)


@router.delete("/agents/{agent_id}/keys/{key_id}", status_code=204)
def delete_agent_key(
    agent_id: str,
    key_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Delete a saved key. Requires user auth."""
    _resolve_user(authorization, db)
    row = agent_key_repo.get(db, key_id)
    if not row or row.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Key not found")
    agent_key_repo.delete(db, key_id)


@router.post("/agents/{agent_id}/keys/{key_id}/test")
def test_agent_key(
    agent_id: str,
    key_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Verify a saved key against the agent's stored hash.
    Returns {valid: bool}. Marks verified_at on success.
    """
    _resolve_user(authorization, db)
    row = agent_key_repo.get(db, key_id)
    if not row or row.agent_id != agent_id:
        raise HTTPException(status_code=404, detail="Key not found")
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    valid = security.verify_api_key(row.key_value, agent.api_key_hash)
    if valid:
        agent_key_repo.mark_verified(db, key_id)
    return {"valid": valid, "agent_id": agent_id, "key_id": key_id}


@router.post("/agents/{agent_id}/rotate-key")
async def rotate_agent_key(
    agent_id: str,
    label: str = Body(default="default", embed=True),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Rotate the agent's API key.

    1. Generate a new key + hash.
    2. Update the agent's hash in DB.
    3. If the agent has an active WS connection, push the new key so it
       updates its own keyfile automatically (no manual intervention needed).
    4. Save the plaintext key server-side so all users can retrieve it.
    5. Return the new plaintext key to the UI.
    """
    _resolve_user(authorization, db)
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    raw_key, key_hash = security.generate_api_key()

    # Update hash in DB
    agent.api_key_hash = key_hash
    db.commit()

    # Push to agent over WebSocket if connected
    pushed = await broker.push_new_key(agent_id, raw_key)

    # Remove all previous saved keys for this agent, store the new one
    agent_key_repo.delete_all_for_agent(db, agent_id)
    row = agent_key_repo.upsert(db, agent_id, raw_key, label)
    agent_key_repo.mark_verified(db, row.id)

    return {
        "agent_id": agent_id,
        "api_key": raw_key,
        "pushed_to_agent": pushed,
        "key_id": row.id,
    }
