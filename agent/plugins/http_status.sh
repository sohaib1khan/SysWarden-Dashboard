#!/bin/bash
# PLUGIN_NAME: http_status
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Check HTTP response code and latency for a URL
# PLUGIN_INTERVAL: 60
# PLUGIN_AUTHOR: SysWarden
# PLUGIN_OUTPUT_SCHEMA: {"status_code":"int","response_time_ms":"float","up":"int"}
#
# Output: JSON array of metric points written to stdout.
# Set HTTP_STATUS_URL env var to override the target URL.
# Requirements: curl

set -euo pipefail

URL="${HTTP_STATUS_URL:-http://localhost:8000/health}"

# curl writes timing and status to stdout; suppress response body
RESULT=$(curl -o /dev/null -s -w "%{http_code} %{time_total}" \
  --connect-timeout 5 --max-time 10 "$URL" 2>/dev/null || echo "0 0")

STATUS_CODE=$(echo "$RESULT" | awk '{print $1}' | sed 's/^0*//' | grep -E '^[0-9]+$' || echo "0")
STATUS_CODE=${STATUS_CODE:-0}
STATUS_CODE=$((10#${STATUS_CODE:-0}))   # force decimal — prevents 000 / 0NNN octal-ish output
TIME_S=$(echo "$RESULT" | awk '{print $2}')
# Round to integer ms and ensure leading zero for values < 1 (e.g. .107 → 0)
TIME_MS=$(printf '%.0f' "$(echo "$TIME_S * 1000" | bc 2>/dev/null || echo '0')" 2>/dev/null || echo "0")
TIME_MS=${TIME_MS:-0}

# "up" = 1 if status is 2xx or 3xx
UP=0
if [[ "$STATUS_CODE" -ge 200 && "$STATUS_CODE" -lt 400 ]]; then
  UP=1
fi

cat <<EOF
[
  {"name": "status_code",       "value": ${STATUS_CODE:-0}, "unit": ""},
  {"name": "response_time_ms",  "value": ${TIME_MS:-0},     "unit": "ms"},
  {"name": "up",                "value": ${UP},              "unit": ""}
]
EOF
