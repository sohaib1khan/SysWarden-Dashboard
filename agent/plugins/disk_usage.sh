#!/bin/bash
# PLUGIN_NAME: disk_usage
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Report disk usage (used %, used/available/total GB) for a filesystem
# PLUGIN_INTERVAL: 300
# PLUGIN_AUTHOR: SysWarden
# PLUGIN_OUTPUT_SCHEMA: {"used_pct":"float","used_gb":"float","avail_gb":"float","total_gb":"float"}
#
# Output: JSON array of metric points written to stdout.
#
# Environment variables:
#   DISK_MOUNT   Filesystem mount point to check. Default: /
#                When running in Docker without a host bind-mount, this reports
#                the container root. To check the real host disk, add:
#                  -v /:/host:ro  and set  DISK_MOUNT=/host
#
# Requirements: df, awk (both standard on Alpine/Debian/RHEL)

set -euo pipefail

MOUNT="${DISK_MOUNT:-/}"

# -P forces POSIX output: Filesystem 1K-blocks Used Available Use% Mounted
LINE=$(df -Pk "$MOUNT" 2>/dev/null | tail -1)

if [[ -z "$LINE" ]]; then
  echo '[{"name":"used_pct","value":0,"unit":"%"},{"name":"used_gb","value":0,"unit":"GB"},{"name":"avail_gb","value":0,"unit":"GB"},{"name":"total_gb","value":0,"unit":"GB"}]'
  exit 0
fi

TOTAL_KB=$(echo "$LINE" | awk '{print $2}')
USED_KB=$(echo "$LINE"  | awk '{print $3}')
AVAIL_KB=$(echo "$LINE" | awk '{print $4}')
USE_PCT=$(echo "$LINE"  | awk '{print $5}' | tr -d '%')

# Convert from 1K-blocks to GB (1 GB = 1 048 576 KB)
TOTAL_GB=$(awk "BEGIN {printf \"%.2f\", ${TOTAL_KB:-0} / 1048576}")
USED_GB=$(awk  "BEGIN {printf \"%.2f\", ${USED_KB:-0}  / 1048576}")
AVAIL_GB=$(awk "BEGIN {printf \"%.2f\", ${AVAIL_KB:-0} / 1048576}")

cat <<EOF
[
  {"name": "used_pct",  "value": ${USE_PCT:-0},   "unit": "%"},
  {"name": "used_gb",   "value": ${USED_GB:-0},   "unit": "GB"},
  {"name": "avail_gb",  "value": ${AVAIL_GB:-0},  "unit": "GB"},
  {"name": "total_gb",  "value": ${TOTAL_GB:-0},  "unit": "GB"}
]
EOF
