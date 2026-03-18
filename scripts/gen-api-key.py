#!/usr/bin/env python3
"""
gen-api-key.py — Print a fresh raw API key (for manual agent bootstrapping).

Usage:
    python3 scripts/gen-api-key.py

This does NOT update the database. Use it to pre-generate a key if you want
to inject it via SYSWARDEN_API_KEY rather than letting the agent self-register.
The key must then be stored (hashed) manually via the registration endpoint.
"""
import secrets

raw = secrets.token_urlsafe(32)
print(f"Raw key:  {raw}")
print("(This key will not be shown again. Store it securely.)")
