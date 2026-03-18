from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy.orm import Session

from app.core import security
from app.core.relay import broker
from app.db.session import get_db
from app.repositories.agent_repo import agent_repo

router = APIRouter(tags=["fetch"])

_CAP_RE = re.compile(r"^[a-z][a-z0-9_.]{0,63}$")


class FetchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    capability: str = Field(..., min_length=1, max_length=64)
    params: dict = Field(default_factory=dict)

    @field_validator("capability")
    @classmethod
    def validate_capability(cls, v: str) -> str:
        if not _CAP_RE.match(v):
            raise ValueError("Invalid capability name")
        return v


@router.post("/agents/{agent_id}/fetch")
async def fetch_from_agent(
    agent_id: str,
    payload: FetchRequest,
    x_api_key: str = Header(..., alias="X-Api-Key"),
    db: Session = Depends(get_db),
):
    """
    Trigger an on-demand capability fetch on a live agent.
    Requires the agent's own API key. Every call is noted in logs.
    """
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent or not security.verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Unauthorized")

    conn = broker.get(agent_id)
    if not conn:
        raise HTTPException(status_code=503, detail="Agent is offline")

    if payload.capability not in conn.capabilities:
        raise HTTPException(
            status_code=400,
            detail=f"Agent does not support capability '{payload.capability}'",
        )

    try:
        result = await conn.fetch(payload.capability, payload.params)
        return {"capability": payload.capability, "data": result}
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))


@router.get("/agents/{agent_id}/capabilities")
def get_capabilities(agent_id: str, db: Session = Depends(get_db)):
    """Return the capabilities of a connected agent, or empty list if offline."""
    if not agent_repo.get_by_id(db, agent_id):
        raise HTTPException(status_code=404, detail="Agent not found")
    conn = broker.get(agent_id)
    return {
        "agent_id": agent_id,
        "online": conn is not None,
        "capabilities": conn.capabilities if conn else [],
    }
