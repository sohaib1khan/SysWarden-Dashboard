"""
relay.py — WebSocket relay broker.

The backend is the hub. Agents connect here and hold a persistent WS connection.
The dashboard triggers on-demand fetches via REST; the relay forwards them to the
correct agent and streams the response back.

Message protocol (JSON):
  Agent → Backend:
    { "type": "register",  "agent_id": "...", "api_key": "...", "capabilities": [...] }
    { "type": "metric",    "agent_id": "...", "metrics": [...] }
    { "type": "response",  "request_id": "...", "data": ..., "error": null }

  Backend → Agent:
    { "type": "fetch",     "request_id": "...", "capability": "...", "params": {...} }
    { "type": "ping" }
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import WebSocket, WebSocketDisconnect

from app.core import evaluator
from app.core.security import verify_api_key
from app.db.session import SessionLocal
from app.repositories.agent_repo import agent_repo
from app.repositories.metric_repo import metric_repo
from app.schemas.metric import MetricPoint

logger = logging.getLogger("relay")


class AgentConnection:
    """Represents one live agent WebSocket connection."""

    def __init__(self, agent_id: str, websocket: WebSocket):
        self.agent_id = agent_id
        self.websocket = websocket
        self.capabilities: list[str] = []
        self.connected_at = datetime.utcnow()
        # Pending fetch requests: request_id → asyncio.Future
        self._pending: Dict[str, asyncio.Future] = {}

    async def send(self, msg: dict) -> None:
        await self.websocket.send_text(json.dumps(msg))

    async def fetch(self, capability: str, params: dict, timeout: float = 30.0) -> Any:
        """Send a fetch request to the agent and await its response."""
        request_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future: asyncio.Future = loop.create_future()
        self._pending[request_id] = future
        try:
            await self.send({
                "type": "fetch",
                "request_id": request_id,
                "capability": capability,
                "params": params,
            })
            return await asyncio.wait_for(future, timeout=timeout)
        except asyncio.TimeoutError:
            raise TimeoutError(f"Agent {self.agent_id} did not respond in {timeout}s")
        finally:
            self._pending.pop(request_id, None)

    def resolve_response(self, request_id: str, data: Any, error: Optional[str]) -> None:
        future = self._pending.get(request_id)
        if not future or future.done():
            return
        if error:
            future.set_exception(RuntimeError(error))
        else:
            future.set_result(data)


class RelayBroker:
    """
    Singleton broker — holds all live agent connections.
    Designed for single-instance deployment. For horizontal scaling,
    replace the in-memory dict with a Redis pub/sub adapter.
    """

    def __init__(self) -> None:
        self._connections: Dict[str, AgentConnection] = {}
        # Pending offline-notification tasks — cancelled if agent reconnects
        # within the grace period (avoids spurious alerts on quick restarts).
        self._offline_tasks: Dict[str, asyncio.Task] = {}

    def get(self, agent_id: str) -> Optional[AgentConnection]:
        return self._connections.get(agent_id)

    def online_ids(self) -> list[str]:
        return list(self._connections.keys())

    async def push_new_key(self, agent_id: str, new_key: str) -> bool:
        """
        Send a key-rotation message to a connected agent.
        The agent will update its in-memory key and persist it to disk.
        Returns True if the message was delivered, False if agent is offline.
        """
        conn = self._connections.get(agent_id)
        if not conn:
            return False
        try:
            await conn.send({"type": "new_key", "api_key": new_key})
            logger.info("pushed key rotation to agent %s", agent_id)
            return True
        except Exception as exc:
            logger.warning("could not push new_key to agent %s: %s", agent_id, exc)
            return False

    async def connect(self, websocket: WebSocket, agent_id: str) -> AgentConnection:
        # Cancel any pending offline-notification for this agent (it reconnected)
        pending = self._offline_tasks.pop(agent_id, None)
        was_pending = pending is not None
        if pending and not pending.done():
            pending.cancel()

        conn = AgentConnection(agent_id, websocket)
        self._connections[agent_id] = conn
        logger.info("agent connected: %s", agent_id)

        # If there was no pending offline task, this is a fresh connect after
        # the agent was truly offline — fire agent_online notification.
        if not was_pending:
            asyncio.create_task(self._notify_agent_online(agent_id))

        return conn

    async def _notify_agent_online(self, agent_id: str) -> None:
        try:
            db = SessionLocal()
            try:
                agent = agent_repo.get_by_id(db, agent_id)
                hostname = agent.hostname if agent else agent_id
            finally:
                db.close()
            from app.core.channel_notifier import dispatch_event
            await dispatch_event(
                "agent_online",
                f"🟢 Agent Online — {hostname}",
                f"Agent '{hostname}' ({agent_id}) has connected to SysWarden.",
            )
        except Exception as exc:
            logger.debug("agent_online notification error: %s", exc)

    def disconnect(self, agent_id: str, conn: Optional['AgentConnection'] = None) -> None:
        # Only remove from _connections if this is still the same connection.
        # If the agent already reconnected with a new WS, the new entry must
        # not be touched — otherwise we'd incorrectly evict the live connection.
        current = self._connections.get(agent_id)
        if conn is not None and current is not conn:
            # Stale disconnect from a superseded WebSocket — do nothing.
            logger.debug("stale disconnect ignored for agent %s", agent_id)
            return
        self._connections.pop(agent_id, None)
        logger.info("agent disconnected: %s", agent_id)
        # Mark offline in DB (best-effort)
        try:
            db = SessionLocal()
            agent_repo.set_offline(db, agent_id)
            db.close()
        except Exception as exc:
            logger.warning("could not set agent offline: %s", exc)

        # Cancel any previously scheduled offline task before creating a new one
        # (prevents orphaned tasks from accumulating on rapid reconnect cycles).
        existing = self._offline_tasks.pop(agent_id, None)
        if existing and not existing.done():
            existing.cancel()

        # Schedule offline notification — cancelled if the agent reconnects
        # within 60 seconds (avoids noise from normal restarts/reconnects).
        task = asyncio.create_task(self._delayed_offline_notify(agent_id))
        self._offline_tasks[agent_id] = task

    async def _delayed_offline_notify(self, agent_id: str, delay: int = 60) -> None:
        try:
            await asyncio.sleep(delay)
            self._offline_tasks.pop(agent_id, None)

            # Final guard: if the agent reconnected during the grace period
            # (e.g. race where new connect beat the old disconnect cleanup),
            # do not send a spurious offline notification.
            if agent_id in self._connections:
                logger.debug("agent %s is online after grace period — skipping offline notify", agent_id)
                return

            db = SessionLocal()
            try:
                agent = agent_repo.get_by_id(db, agent_id)
                hostname = (agent.hostname or agent_id) if agent else agent_id
            finally:
                db.close()
            from app.core.channel_notifier import dispatch_event
            await dispatch_event(
                "agent_offline",
                f"🔴 Agent Offline — {hostname}",
                f"Agent '{hostname}' ({agent_id}) has disconnected from SysWarden.",
            )
        except asyncio.CancelledError:
            pass  # Agent reconnected — notification suppressed
        except Exception as exc:
            logger.debug("agent_offline notification error: %s", exc)

    async def handle_agent(self, websocket: WebSocket) -> None:
        """
        Main loop for an agent WebSocket connection.
        Expects the first message to be a 'register' handshake.
        """
        agent_id: Optional[str] = None
        conn: Optional[AgentConnection] = None

        try:
            # Accept the WS upgrade before any sends/receives
            await websocket.accept()

            # ── Handshake ────────────────────────────────────────────────────
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=10.0)
            msg = json.loads(raw)

            if msg.get("type") != "register":
                await websocket.close(code=4001, reason="expected register")
                return

            agent_id = msg.get("agent_id", "")
            api_key = msg.get("api_key", "")

            # Validate credentials
            db = SessionLocal()
            try:
                agent = agent_repo.get_by_id(db, agent_id)
                if not agent or not verify_api_key(api_key, agent.api_key_hash):
                    await websocket.close(code=4003, reason="unauthorized")
                    return
            finally:
                db.close()

            conn = await self.connect(websocket, agent_id)
            conn.capabilities = msg.get("capabilities", [])

            # Update DB: mark online, record capabilities
            db = SessionLocal()
            try:
                agent_repo.update_last_seen(db, agent_id)
            finally:
                db.close()

            await conn.send({"type": "welcome", "agent_id": agent_id})
            logger.info("agent %s authenticated, capabilities=%s", agent_id, conn.capabilities)

            # ── Message loop ─────────────────────────────────────────────────
            while True:
                raw = await websocket.receive_text()
                msg = json.loads(raw)
                msg_type = msg.get("type")

                if msg_type == "metric":
                    await self._handle_metrics(agent_id, msg)

                elif msg_type == "response":
                    conn.resolve_response(
                        msg.get("request_id", ""),
                        msg.get("data"),
                        msg.get("error"),
                    )

                elif msg_type == "ping":
                    await conn.send({"type": "pong"})

        except WebSocketDisconnect:
            pass
        except asyncio.TimeoutError:
            logger.warning("agent handshake timed out")
        except Exception as exc:
            logger.error("relay error (agent=%s): %s", agent_id, exc)
        finally:
            if agent_id and conn:
                self.disconnect(agent_id, conn)

    async def _handle_metrics(self, agent_id: str, msg: dict) -> None:
        """Persist inlined metric payloads and run alert evaluation."""
        raw_points = msg.get("metrics", [])
        if not raw_points:
            return
        try:
            points = [MetricPoint(**p) for p in raw_points]

            # ── Ingest + update last-seen ─────────────────────────────────────
            # Use a short-lived session that is closed BEFORE any async await.
            # Holding a session across awaits blocks the SQLite file handle and
            # exhausts the connection pool under concurrent agents.
            db = SessionLocal()
            try:
                metric_repo.ingest(db, agent_id, points)
                agent_repo.update_last_seen(db, agent_id)
            finally:
                db.close()

            # ── Alert evaluation ──────────────────────────────────────────────
            # evaluator manages its own sessions internally so the DB is never
            # held open across the async HTTP webhook dispatches it may do.
            await evaluator.evaluate(agent_id, points)
        except Exception as exc:
            logger.warning("metric ingest via WS failed (agent=%s): %s", agent_id, exc)


# Module-level singleton — imported by main.py and the fetch route
broker = RelayBroker()
