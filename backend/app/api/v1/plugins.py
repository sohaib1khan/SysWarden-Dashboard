"""
plugins.py — Plugin registry routes.

  POST   /plugins/announce         → Agent announces its discovered plugins (X-Api-Key auth)
  GET    /plugins                  → List all plugins (optionally ?agent_id=…)
  GET    /plugins/{plugin_id}      → Get one plugin
  PATCH  /plugins/{plugin_id}      → Enable / disable a plugin (user auth)
  DELETE /plugins/{plugin_id}      → Remove from registry (admin auth)
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.repositories.agent_repo import agent_repo
from app.repositories.plugin_repo import plugin_repo
from app.core.security import verify_api_key
from app.api.v1.auth import _resolve_user, _require_admin

router = APIRouter(prefix="/plugins", tags=["plugins"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

class PluginManifest(BaseModel):
    name: str = Field(max_length=128)
    version: str = Field(default="1.0.0", max_length=32)
    description: str = Field(default="")
    author: str = Field(default="", max_length=128)
    interval_seconds: int = Field(default=60, ge=5, le=86400)
    output_schema: str = Field(default="{}")


class AnnounceRequest(BaseModel):
    agent_id: str
    plugins: list[PluginManifest]


class PluginOut(BaseModel):
    id: int
    agent_id: str
    name: str
    version: str
    description: str
    author: str
    interval_seconds: int
    output_schema: str
    enabled: bool
    last_seen: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


class PatchPluginRequest(BaseModel):
    enabled: bool


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/announce", status_code=204)
def announce_plugins(
    body: AnnounceRequest,
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Called by the agent on startup to register/update discovered plugins.
    Authenticated via the agent's X-Api-Key.
    """
    agent = agent_repo.get_by_id(db, body.agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not x_api_key or not verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")

    for manifest in body.plugins:
        plugin_repo.upsert(
            db,
            agent_id=body.agent_id,
            name=manifest.name,
            version=manifest.version,
            description=manifest.description,
            author=manifest.author,
            interval_seconds=manifest.interval_seconds,
            output_schema=manifest.output_schema,
        )


@router.post("/touch", status_code=204)
def touch_plugin(
    body: dict,
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Called by the agent after each successful plugin run to update last_seen.
    body: { "agent_id": "...", "plugin_name": "..." }
    """
    agent_id = body.get("agent_id", "")
    plugin_name = body.get("plugin_name", "")
    if not agent_id or not plugin_name:
        raise HTTPException(status_code=422, detail="agent_id and plugin_name required")
    agent = agent_repo.get_by_id(db, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if not x_api_key or not verify_api_key(x_api_key, agent.api_key_hash):
        raise HTTPException(status_code=401, detail="Invalid API key")
    plugin_repo.touch(db, agent_id, plugin_name)


@router.get("", response_model=list[PluginOut])
def list_plugins(
    agent_id: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    return [PluginOut.model_validate(p) for p in plugin_repo.list_all(db, agent_id)]


@router.get("/{plugin_id}", response_model=PluginOut)
def get_plugin(
    plugin_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    plugin = plugin_repo.get_by_id(db, plugin_id)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return PluginOut.model_validate(plugin)


@router.patch("/{plugin_id}", response_model=PluginOut)
def patch_plugin(
    plugin_id: int,
    body: PatchPluginRequest,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _resolve_user(authorization, db)
    plugin = plugin_repo.set_enabled(db, plugin_id, body.enabled)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    return PluginOut.model_validate(plugin)


@router.delete("/{plugin_id}", status_code=204)
def delete_plugin(
    plugin_id: int,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    _require_admin(authorization, db)
    plugin = plugin_repo.get_by_id(db, plugin_id)
    if not plugin:
        raise HTTPException(status_code=404, detail="Plugin not found")
    plugin_repo.delete(db, plugin_id)
