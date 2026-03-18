from __future__ import annotations

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from app.config import settings

_is_sqlite = "sqlite" in settings.database_url

# SQLite is a single-file database that handles its own locking.
# Connection pooling adds no benefit and causes pool-exhaustion errors when
# many async tasks each hold a session open across awaits.
# NullPool opens a fresh connection per SessionLocal() call and closes it
# immediately on session.close() — no pool limits, no timeout errors.
#
# For PostgreSQL/MySQL keep the default QueuePool but tune it for load.
_engine_kwargs: dict = {}
if _is_sqlite:
    _engine_kwargs = {
        "connect_args": {"check_same_thread": False, "timeout": 15},
        "poolclass": NullPool,
    }
else:
    _engine_kwargs = {
        "pool_size": 20,
        "max_overflow": 10,
        "pool_pre_ping": True,
    }

engine = create_engine(settings.database_url, **_engine_kwargs)

# Enable WAL mode for SQLite so concurrent readers/writers don't block each other.
if _is_sqlite:
    @event.listens_for(engine, "connect")
    def _set_sqlite_wal(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def init_db() -> None:
    """Create all tables on startup. Safe to call multiple times."""
    from app.models import agent, metric  # noqa: F401 — side-effect: register models
    import app.models.alert  # noqa: F401
    import app.models.push_subscription  # noqa: F401
    import app.models.notification_channel  # noqa: F401

    Base.metadata.create_all(bind=engine)
    _migrate_monitors()


def _migrate_monitors() -> None:
    """Add group_name / sort_order columns to the monitors table if they are missing.

    SQLAlchemy create_all() does not ALTER existing tables, so we handle it
    explicitly here.  Safe to call repeatedly — existing columns are left alone.
    """
    from sqlalchemy import inspect as sa_inspect, text

    insp = sa_inspect(engine)
    if "monitors" not in insp.get_table_names():
        return
    existing = {c["name"] for c in insp.get_columns("monitors")}
    with engine.begin() as conn:
        if "group_name" not in existing:
            conn.execute(
                text("ALTER TABLE monitors ADD COLUMN group_name TEXT NOT NULL DEFAULT 'General'")
            )
        if "sort_order" not in existing:
            conn.execute(
                text("ALTER TABLE monitors ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            )
        if "ignore_tls" not in existing:
            conn.execute(text("ALTER TABLE monitors ADD COLUMN ignore_tls INTEGER NOT NULL DEFAULT 0"))
        if "cache_buster" not in existing:
            conn.execute(text("ALTER TABLE monitors ADD COLUMN cache_buster INTEGER NOT NULL DEFAULT 0"))
        if "upside_down" not in existing:
            conn.execute(text("ALTER TABLE monitors ADD COLUMN upside_down INTEGER NOT NULL DEFAULT 0"))
        if "notify_cert_expiry_days" not in existing:
            conn.execute(text("ALTER TABLE monitors ADD COLUMN notify_cert_expiry_days INTEGER NOT NULL DEFAULT 0"))
        if "consecutive_failures" not in existing:
            conn.execute(text("ALTER TABLE monitors ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0"))


def get_db():
    """FastAPI dependency — yields a DB session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
