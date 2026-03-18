from __future__ import annotations

from fastapi import APIRouter, WebSocket

from app.core.relay import broker

router = APIRouter(tags=["relay"])


@router.websocket("/ws/agent")
async def agent_websocket(websocket: WebSocket):
    """
    Persistent WebSocket endpoint for agent connections.
    Agents connect here once and hold the connection open.
    Authentication is done via the first 'register' message.
    """
    await broker.handle_agent(websocket)
