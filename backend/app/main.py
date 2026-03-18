from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import settings
from app.core.middleware import RequestSizeLimitMiddleware
from app.db.session import init_db
import app.models.alert  # noqa: F401 — ensure alert tables are created
import app.models.agent_key  # noqa: F401 — ensure agent_keys table is created
import app.models.push_subscription  # noqa: F401 — ensure push_subscriptions table is created
import app.models.user  # noqa: F401 — ensure users table is created
import app.models.plugin  # noqa: F401 — ensure plugins table is created
import app.models.plugin_script  # noqa: F401 — ensure plugin_scripts table is created
import app.models.monitor  # noqa: F401 — ensure monitors tables are created
import app.models.notification_channel  # noqa: F401 — ensure notification_channels table is created
from app.api.v1 import agents, agent_downloads, alerts, auth, config_io, fetch, metrics, monitors, notifications, plugins, plugin_store, push, relay
from app.core.monitor_checker import start_checker


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    await start_checker()
    yield


limiter = Limiter(key_func=get_remote_address, default_limits=[settings.rate_limit])

app = FastAPI(
    title="SysWarden API",
    version="0.1.0",
    # Disable auto-generated docs in production if desired
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Security middleware (order matters — outermost runs first) ─────────────────

app.add_middleware(RequestSizeLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.get_allowed_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Api-Key", "X-Agent-Id"],
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── Routers ────────────────────────────────────────────────────────────────────

app.include_router(agents.router, prefix="/api/v1")
app.include_router(agent_downloads.router, prefix="/api/v1")
app.include_router(metrics.router, prefix="/api/v1")
app.include_router(fetch.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(push.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(plugins.router, prefix="/api/v1")
app.include_router(plugin_store.router, prefix="/api/v1")
app.include_router(monitors.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(config_io.router, prefix="/api/v1")
app.include_router(relay.router)  # /ws/agent — no /api/v1 prefix, WS path


# ── Health ─────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
def health():
    """Liveness probe — used by Docker healthcheck and reverse proxies."""
    return {"status": "ok", "version": "0.1.0"}
