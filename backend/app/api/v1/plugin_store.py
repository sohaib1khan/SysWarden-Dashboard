"""
plugin_store.py — Plugin Store routes.

  User routes (JWT auth):
    GET    /plugin-store           → list all scripts
    GET    /plugin-store/{name}    → get one
    POST   /plugin-store           → create
    PATCH  /plugin-store/{name}    → update
    DELETE /plugin-store/{name}    → delete

  Agent routes (X-Api-Key + X-Agent-Id):
    GET    /agent/plugins/sync              → list enabled scripts (name + checksum)
    GET    /agent/plugins/download/{name}   → download script content as plain text
"""
from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.v1.auth import _resolve_user
from app.core.security import verify_api_key
from app.db.session import get_db
from app.models.plugin_script import PluginScript
from app.repositories.agent_repo import agent_repo

router = APIRouter(tags=["plugin-store"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PluginScriptIn(BaseModel):
    name: str = Field(max_length=128)
    description: str = Field(default="", max_length=512)
    script: str = Field(min_length=1)
    version: str = Field(default="1.0.0", max_length=32)
    plugin_type: str = Field(default="metric", pattern="^(metric|capability)$")
    capability_name: Optional[str] = Field(default=None, max_length=128)
    enabled: bool = True


class PluginScriptOut(BaseModel):
    id: int
    name: str
    description: str
    checksum: str
    version: str
    plugin_type: str
    capability_name: Optional[str]
    enabled: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PluginScriptUpdate(BaseModel):
    description: Optional[str] = Field(default=None, max_length=512)
    script: Optional[str] = None
    version: Optional[str] = Field(default=None, max_length=32)
    plugin_type: Optional[str] = Field(default=None, pattern="^(metric|capability)$")
    capability_name: Optional[str] = Field(default=None, max_length=128)
    enabled: Optional[bool] = None


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


# ---------------------------------------------------------------------------
# Auth helper for agent endpoints
# ---------------------------------------------------------------------------

def _auth_agent(
    x_api_key: str | None,
    x_agent_id: str | None,
    db: Session,
):
    if not x_api_key or not x_agent_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    agent = agent_repo.get_by_id(db, x_agent_id)
    if not agent or not verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Unauthorized")
    return agent


# ---------------------------------------------------------------------------
# User routes (JWT)
# ---------------------------------------------------------------------------

@router.get("/plugin-store", response_model=list[PluginScriptOut])
def list_scripts(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    return db.query(PluginScript).order_by(PluginScript.name).all()


@router.get("/plugin-store/{name}", response_model=PluginScriptOut)
def get_script(
    name: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    ps = db.query(PluginScript).filter(PluginScript.name == name).first()
    if not ps:
        raise HTTPException(status_code=404, detail="Script not found")
    return ps


@router.post("/plugin-store", response_model=PluginScriptOut, status_code=201)
def create_script(
    body: PluginScriptIn,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    if db.query(PluginScript).filter(PluginScript.name == body.name).first():
        raise HTTPException(status_code=409, detail=f"Script '{body.name}' already exists")
    ps = PluginScript(
        name=body.name,
        description=body.description,
        script=body.script,
        checksum=_sha256(body.script),
        version=body.version,
        plugin_type=body.plugin_type,
        capability_name=body.capability_name,
        enabled=body.enabled,
    )
    db.add(ps)
    db.commit()
    db.refresh(ps)
    return ps


@router.patch("/plugin-store/{name}", response_model=PluginScriptOut)
def update_script(
    name: str,
    body: PluginScriptUpdate,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    ps = db.query(PluginScript).filter(PluginScript.name == name).first()
    if not ps:
        raise HTTPException(status_code=404, detail="Script not found")
    if body.description is not None:
        ps.description = body.description
    if body.script is not None:
        ps.script = body.script
        ps.checksum = _sha256(body.script)
    if body.version is not None:
        ps.version = body.version
    if body.plugin_type is not None:
        ps.plugin_type = body.plugin_type
    if body.capability_name is not None:
        ps.capability_name = body.capability_name
    if body.enabled is not None:
        ps.enabled = body.enabled
    ps.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(ps)
    return ps


@router.delete("/plugin-store/{name}", status_code=204)
def delete_script(
    name: str,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    ps = db.query(PluginScript).filter(PluginScript.name == name).first()
    if not ps:
        raise HTTPException(status_code=404, detail="Script not found")
    db.delete(ps)
    db.commit()


# ---------------------------------------------------------------------------
# Agent routes (X-Api-Key + X-Agent-Id)
# ---------------------------------------------------------------------------

@router.get("/agent/plugins/sync")
def agent_sync_list(
    x_api_key: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None, alias="X-Agent-Id"),
    db: Session = Depends(get_db),
):
    """
    Return metadata for all enabled backend scripts.
    Agents poll this to detect new/changed scripts without downloading them all.
    """
    _auth_agent(x_api_key, x_agent_id, db)
    scripts = db.query(PluginScript).filter(PluginScript.enabled.is_(True)).all()
    return [
        {
            "name": s.name,
            "checksum": s.checksum,
            "version": s.version,
            "plugin_type": s.plugin_type,
            "capability_name": s.capability_name,
        }
        for s in scripts
    ]


@router.get("/agent/plugins/download/{name}", response_class=PlainTextResponse)
def agent_download_script(
    name: str,
    x_api_key: str | None = Header(default=None),
    x_agent_id: str | None = Header(default=None, alias="X-Agent-Id"),
    db: Session = Depends(get_db),
):
    """Return the raw script content as plain text. Agent saves this to disk."""
    _auth_agent(x_api_key, x_agent_id, db)
    ps = (
        db.query(PluginScript)
        .filter(PluginScript.name == name, PluginScript.enabled.is_(True))
        .first()
    )
    if not ps:
        raise HTTPException(status_code=404, detail="Script not found or disabled")
    return ps.script
