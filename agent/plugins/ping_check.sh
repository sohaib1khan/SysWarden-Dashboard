#!/bin/bash
# PLUGIN_NAME: ping_check
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Ping the default gateway and measure round-trip latency
# PLUGIN_INTERVAL: 30
# PLUGIN_AUTHOR: SysWarden
# PLUGIN_OUTPUT_SCHEMA: {"latency_ms":"float","packet_loss_pct":"float"}
#
# Output: JSON array of metric points written to stdout.
# Requirements: ping (standard on Linux/macOS)

set -euo pipefail

TARGET="${PING_TARGET:-8.8.8.8}"
COUNT=4

# Run ping and parse summary line
PING_OUT=$(ping -c "$COUNT" -W 2 "$TARGET" 2>&1 || true)

# Extract average latency from "rtt min/avg/max/mdev = 1.2/3.4/5.6/0.8 ms"
AVG_MS=$(echo "$PING_OUT" | grep -oP 'rtt.*=\s*[\d.]+/\K[\d.]+' || echo "0")

# Extract packet loss from "X% packet loss"
LOSS=$(echo "$PING_OUT" | grep -oP '\d+(?=% packet loss)' || echo "0")

cat <<EOF
[
  {"name": "latency_ms",      "value": ${AVG_MS:-0}, "unit": "ms"},
  {"name": "packet_loss_pct", "value": ${LOSS:-0},   "unit": "%"}
]
EOF
