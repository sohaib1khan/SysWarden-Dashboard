#!/bin/bash
# PLUGIN_NAME: ssl_expiry
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Check days remaining until an SSL certificate expires
# PLUGIN_INTERVAL: 3600
# PLUGIN_AUTHOR: SysWarden
# PLUGIN_OUTPUT_SCHEMA: {"days_remaining":"int","valid":"int"}
#
# Output: JSON array of metric points written to stdout.
# Set SSL_EXPIRY_HOST env var to the hostname to check (default: localhost).
# Requirements: openssl

set -euo pipefail

HOST="${SSL_EXPIRY_HOST:-localhost}"
PORT="${SSL_EXPIRY_PORT:-443}"

# Fetch the cert expiry date
EXPIRY=$(echo | openssl s_client -servername "$HOST" -connect "$HOST:$PORT" 2>/dev/null \
  | openssl x509 -noout -enddate 2>/dev/null \
  | sed 's/notAfter=//' || echo "")

DAYS=0
VALID=0

if [[ -n "$EXPIRY" ]]; then
  EXPIRY_TS=$(date -d "$EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %T %Y %Z" "$EXPIRY" +%s 2>/dev/null || echo "0")
  NOW_TS=$(date +%s)
  if [[ "$EXPIRY_TS" -gt 0 ]]; then
    DAYS=$(( (EXPIRY_TS - NOW_TS) / 86400 ))
    VALID=1
  fi
fi

cat <<EOF
[
  {"name": "days_remaining", "value": ${DAYS},  "unit": "days"},
  {"name": "valid",          "value": ${VALID}, "unit": ""}
]
EOF
