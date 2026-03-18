"""
vapid.py — VAPID key management helpers.

On first call to `ensure_keys()` the key pair is generated and persisted to
a JSON file at the path configured via VAPID_KEY_FILE (default /app/data/vapid.json).
This lets the same key survive container restarts without needing env vars to be
manually populated.
"""
from __future__ import annotations

import json
import logging
import os

logger = logging.getLogger("vapid")

_KEY_FILE = os.environ.get("VAPID_KEY_FILE", "/app/data/vapid.json")


def _load_from_file() -> tuple[str, str] | None:
    try:
        with open(_KEY_FILE) as f:
            d = json.load(f)
        return d["private"], d["public"]
    except (FileNotFoundError, KeyError, json.JSONDecodeError):
        return None


def _generate_and_save() -> tuple[str, str]:
    """Generate a new VAPID key pair and persist to disk.

    Uses the `cryptography` library (bundled with python-jose) rather than
    py_vapid, whose key-object API changed in pywebpush 2.x.
    """
    import base64
    from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PrivateFormat, PublicFormat, NoEncryption,
    )

    key = generate_private_key(SECP256R1())

    # Public key: 65-byte uncompressed point → base64url (what browsers expect
    # for PushManager.subscribe({ applicationServerKey: ... }))
    pub_bytes = key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    public_key = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode()

    # Private key: SEC1 PEM ("BEGIN EC PRIVATE KEY") — what pywebpush 2.x
    # webpush() accepts for vapid_private_key
    priv_pem = key.private_bytes(Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption())
    private_key = priv_pem.decode()

    os.makedirs(os.path.dirname(_KEY_FILE), exist_ok=True)
    with open(_KEY_FILE, "w") as f:
        json.dump({"private": private_key, "public": public_key}, f)

    logger.info("Generated new VAPID key pair and saved to %s", _KEY_FILE)
    return private_key, public_key


_cached: tuple[str, str] | None = None


def ensure_keys() -> tuple[str, str]:
    """
    Return (private_key, public_key) as PEM/base64url strings.
    Priority: env config → key file → auto-generate.
    """
    global _cached
    if _cached:
        return _cached

    from app.config import settings  # local import to avoid circulars

    if settings.vapid_private_key and settings.vapid_public_key:
        _cached = (settings.vapid_private_key, settings.vapid_public_key)
        return _cached

    loaded = _load_from_file()
    if loaded:
        _cached = loaded
        return _cached

    try:
        _cached = _generate_and_save()
    except Exception as exc:
        logger.warning("Could not generate VAPID keys: %s — push notifications disabled", exc)
        _cached = ("", "")

    return _cached
