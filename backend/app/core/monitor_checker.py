"""
monitor_checker.py — Background service that probes each monitor on its schedule.

Architecture:
  - A single dispatcher coroutine wakes up every CHECK_INTERVAL seconds.
  - It queries all enabled monitors whose last_checked is None or older
    than their interval_s, then probes each one concurrently.
  - HTTP / Keyword: httpx async GET (or HEAD) with per-monitor timeout.
  - TCP: asyncio.open_connection with per-monitor timeout.
  - Results are written back to the DB (sync session in thread pool).
  - On any status *change*, a WebSocket broadcast is sent to dashboard clients
    (best-effort — failure never crashes the checker).
"""
from __future__ import annotations

import asyncio
import logging
import socket
import ssl
import time
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger("monitor_checker")

CHECK_INTERVAL = 10  # seconds between dispatcher wake-ups


# Semaphore: cap simultaneous SSL handshakes to avoid connection storms
# (all monitors fire in the same tick — without this, 30+ concurrent SSL
# handshakes can flood the local network and trigger Cloudflare Tunnel resets)
_CHECK_SEMAPHORE: asyncio.Semaphore | None = None

# Tracks monitor IDs with a probe currently in flight.
# Prevents the dispatcher from scheduling a duplicate concurrent probe for the
# same monitor when a probe takes longer than CHECK_INTERVAL to complete.
_in_flight: set[int] = set()


def _get_semaphore() -> asyncio.Semaphore:
    global _CHECK_SEMAPHORE
    if _CHECK_SEMAPHORE is None:
        _CHECK_SEMAPHORE = asyncio.Semaphore(15)
    return _CHECK_SEMAPHORE


async def _probe_http(
    url: str,
    method: str,
    keyword: Optional[str],
    timeout_s: int,
    ignore_tls: bool = False,
    cache_buster: bool = False,
):
    """Returns (status, response_time_ms, error_msg).

    Retries once on connection-level exceptions (SSL reset, EOF, timeout)
    which are common with Cloudflare Tunnel and flaky networks.
    """
    import httpx

    # Cache buster: append random param to bypass CDN caches
    probe_url = url
    if cache_buster:
        sep = "&" if "?" in probe_url else "?"
        probe_url = f"{probe_url}{sep}_sw={uuid.uuid4().hex[:8]}"

    last_exc: Exception | None = None
    last_http_status: int | None = None
    for attempt in range(2):
        try:
            start = time.perf_counter()
            async with httpx.AsyncClient(
                follow_redirects=True,
                # Separate connect (SSL handshake) from read timeout so a slow
                # TLS negotiation doesn't count against the data-read budget.
                timeout=httpx.Timeout(connect=min(timeout_s, 10), read=timeout_s, write=5, pool=5),
                verify=not ignore_tls,
                # Force HTTP/1.1 — HTTP/2 can cause protocol errors with some
                # Cloudflare Tunnel configurations.
                http2=False,
                headers={"User-Agent": "SysWarden-Monitor/1.0 (uptime checker)"},
            ) as client:
                req_method = getattr(client, method.lower())
                resp = await req_method(probe_url)
            elapsed_ms = (time.perf_counter() - start) * 1000

            if keyword:
                if keyword not in resp.text:
                    return "down", elapsed_ms, f"Keyword '{keyword}' not found in response"

            if 200 <= resp.status_code < 400:
                return "up", elapsed_ms, None

            # 5xx server errors: retry once before reporting down.
            # Catches brief Cloudflare Tunnel / upstream proxy hiccups (502, 503, 524).
            if resp.status_code >= 500 and attempt == 0:
                last_http_status = resp.status_code
                await asyncio.sleep(1.5)
                continue

            return "down", elapsed_ms, f"HTTP {resp.status_code}"

        except Exception as exc:
            last_exc = exc
            if attempt == 0:
                # Brief pause before retry — gives transient connections time to clear
                await asyncio.sleep(1.5)

    # Both attempts failed — capture a useful error message even for exceptions
    # whose str() representation is empty (e.g. ConnectionResetError, TimeoutError)
    if last_exc:
        err_str = str(last_exc) or type(last_exc).__name__
        return "down", None, err_str[:256]
    return "down", None, f"HTTP {last_http_status}"


def _get_cert_expiry_days(hostname: str, port: int, timeout_s: int) -> Optional[int]:
    """Blocking: returns days until the TLS cert expires, or None on error."""
    try:
        ctx = ssl.create_default_context()
        with socket.create_connection((hostname, port), timeout=timeout_s) as sock:
            with ctx.wrap_socket(sock, server_hostname=hostname) as ssock:
                cert = ssock.getpeercert()
        not_after = cert.get("notAfter", "")
        if not not_after:
            return None
        expiry = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(
            tzinfo=timezone.utc
        )
        return max(0, (expiry - datetime.now(timezone.utc)).days)
    except Exception:
        return None


async def _probe_tcp(host: str, port: int, timeout_s: int):
    """Returns (status, response_time_ms, error_msg)."""
    try:
        start = time.perf_counter()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port), timeout=timeout_s
        )
        elapsed_ms = (time.perf_counter() - start) * 1000
        writer.close()
        await writer.wait_closed()
        return "up", elapsed_ms, None
    except Exception as exc:
        return "down", None, str(exc)[:256]


async def _check_one(monitor_id: int) -> None:
    """Load monitor from DB, probe it, save result — all in one async task."""
    from app.db.session import SessionLocal
    from app.repositories.monitor_repo import monitor_repo

    loop = asyncio.get_running_loop()

    # Read monitor in thread (sync SQLAlchemy)
    def _get():
        db = SessionLocal()
        try:
            return monitor_repo.get_by_id(db, monitor_id)
        finally:
            db.close()

    m = await loop.run_in_executor(None, _get)
    if not m or not m.enabled:
        return

    # Perform the probe
    if m.type in ("http", "keyword"):
        status, rt_ms, err = await _probe_http(
            m.url,
            m.method,
            m.keyword if m.type == "keyword" else None,
            m.timeout_s,
            ignore_tls=m.ignore_tls,
            cache_buster=m.cache_buster,
        )
    elif m.type == "tcp":
        host = m.url
        port = m.port or 80
        status, rt_ms, err = await _probe_tcp(host, port, m.timeout_s)
    else:
        logger.warning("Unknown monitor type %s for monitor %d", m.type, m.id)
        return

    # Upside-down mode: flip the result before saving / notifying
    if m.upside_down:
        status = "down" if status == "up" else "up"

    # ── 3-strike rule: absorb transient blips ──────────────────────────────────
    # A monitor only officially goes DOWN after 3 consecutive failed checks.
    # Any passing check immediately resets the counter and restores UP.
    # 3 strikes at the default 60s interval = 3 minutes of genuine failure before
    # alerting, which is resilient against Cloudflare Tunnel transients and
    # intermittent upstream proxy errors.
    FAILURE_THRESHOLD = 2
    if status == "up":
        new_consecutive_failures = 0
        effective_status = "up"
    else:
        new_consecutive_failures = (getattr(m, "consecutive_failures", 0) or 0) + 1
        if new_consecutive_failures >= FAILURE_THRESHOLD:
            effective_status = "down"
        else:
            # First failure — hold current status, don't flip yet
            effective_status = m.status if m.status != "unknown" else "up"
            logger.debug(
                "Monitor %d '%s' probe failed (%d/%d) — holding status '%s'",
                m.id, m.name, new_consecutive_failures, FAILURE_THRESHOLD, effective_status,
            )

    prev_status = m.status

    # Cert expiry notification (HTTPS only, non-blocking, never raises)
    if m.notify_cert_expiry_days > 0 and m.url.lower().startswith("https://"):
        try:
            from urllib.parse import urlparse
            parsed = urlparse(m.url)
            hostname = parsed.hostname or ""
            port = parsed.port or 443
            if hostname:
                days = await loop.run_in_executor(
                    None, _get_cert_expiry_days, hostname, port, m.timeout_s
                )
                if days is not None and days <= m.notify_cert_expiry_days:
                    from app.core.channel_notifier import dispatch_event
                    asyncio.create_task(dispatch_event(
                        "monitor_cert_expiry",
                        f"\U0001f510 Certificate Expiring \u2014 {m.name}",
                        (
                            f"TLS certificate for '{m.name}' expires in {days} day(s).\n"
                            f"URL: {m.url}"
                        ),
                    ))
        except Exception as _cert_exc:
            logger.debug("cert expiry check error: %s", _cert_exc)

    # Write result in thread
    def _save():
        db = SessionLocal()
        try:
            monitor = monitor_repo.get_by_id(db, monitor_id)
            if not monitor:
                return
            monitor_repo.update_status(db, monitor, effective_status, rt_ms, new_consecutive_failures)
            monitor_repo.create_event(db, monitor_id, effective_status, rt_ms, err)
        finally:
            db.close()

    await loop.run_in_executor(None, _save)

    # Log and notify on status changes
    if effective_status != prev_status:
        icon = "🟢" if effective_status == "up" else "🔴"
        logger.info(
            "%s Monitor %d '%s' changed: %s → %s (%.0fms)",
            icon, m.id, m.name, prev_status, effective_status, rt_ms or 0
        )
        # Only notify on meaningful transitions (skip 'unknown' → anything on first check)
        if prev_status != "unknown":
            try:
                from app.core.channel_notifier import dispatch_event
                if effective_status == "down":
                    event_type = "monitor_down"
                    title = f"🔴 Monitor Down — {m.name}"
                    body = (
                        f"Monitor '{m.name}' is DOWN.\n"
                        f"Type: {m.type.upper()}  |  Target: {m.url}"
                        + (f":{m.port}" if m.port else "")
                        + (f"\nError: {err}" if err else "")
                    )
                else:
                    event_type = "monitor_up"
                    title = f"🟢 Monitor Recovered — {m.name}"
                    body = (
                        f"Monitor '{m.name}' is back UP.\n"
                        f"Type: {m.type.upper()}  |  Target: {m.url}"
                        + (f":{m.port}" if m.port else "")
                        + (f"\nResponse time: {rt_ms:.0f}ms" if rt_ms else "")
                    )
                asyncio.create_task(dispatch_event(event_type, title, body))
            except Exception as _exc:
                logger.debug("notification dispatch error: %s", _exc)


async def _dispatcher() -> None:
    """Main loop: find due monitors and probe them concurrently."""
    from app.db.session import SessionLocal
    from app.repositories.monitor_repo import monitor_repo
    import asyncio

    loop = asyncio.get_running_loop()

    while True:
        try:
            def _get_due():
                db = SessionLocal()
                try:
                    now = datetime.utcnow()
                    monitors = monitor_repo.list_all(db, enabled_only=True)
                    due = []
                    for m in monitors:
                        if m.last_checked is None:
                            due.append(m.id)
                        elif (now - m.last_checked).total_seconds() >= m.interval_s:
                            due.append(m.id)
                    return due
                finally:
                    db.close()

            due_ids = await loop.run_in_executor(None, _get_due)

            if due_ids:
                # Skip monitors already being probed to prevent duplicate concurrent
                # probes racing each other and producing false consecutive failures.
                new_ids = [mid for mid in due_ids if mid not in _in_flight]
                sem = _get_semaphore()

                async def _bounded(mid: int) -> None:
                    _in_flight.add(mid)
                    try:
                        async with sem:
                            await _check_one(mid)
                    finally:
                        _in_flight.discard(mid)

                await asyncio.gather(*[_bounded(mid) for mid in new_ids])

        except Exception:
            logger.exception("Monitor dispatcher error")

        await asyncio.sleep(CHECK_INTERVAL)


# ── In-flight deduplication helpers ──────────────────────────────────────────
# Used by _dispatcher to skip monitors already being probed, so a slow probe
# (e.g. taking > CHECK_INTERVAL seconds) never spawns a second concurrent
# probe for the same monitor.


async def start_checker() -> None:
    """Spawn the dispatcher as a fire-and-forget background task."""
    asyncio.create_task(_dispatcher(), name="monitor_checker")
    logger.info("Monitor checker started (dispatcher interval=%ds)", CHECK_INTERVAL)
