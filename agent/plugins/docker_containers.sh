#!/bin/bash
# PLUGIN_NAME: docker_containers
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: Report running, stopped, and total Docker container counts
# PLUGIN_INTERVAL: 30
# PLUGIN_AUTHOR: SysWarden
# PLUGIN_OUTPUT_SCHEMA: {"running":"int","stopped":"int","total":"int","paused":"int"}
#
# Output: JSON array of metric points written to stdout.
#
# Requirements: docker (user running agent must have docker socket access)
#   If running as a non-root user, add to docker group:
#     sudo usermod -aG docker $USER
#
set -euo pipefail

# Check if docker is available
if ! command -v docker &>/dev/null; then
    cat <<EOF
[
  {"name": "running",  "value": 0, "unit": "containers"},
  {"name": "stopped",  "value": 0, "unit": "containers"},
  {"name": "paused",   "value": 0, "unit": "containers"},
  {"name": "total",    "value": 0, "unit": "containers"}
]
EOF
    exit 0
fi

# Check if docker daemon is reachable
if ! docker info &>/dev/null 2>&1; then
    cat <<EOF
[
  {"name": "running",  "value": 0, "unit": "containers"},
  {"name": "stopped",  "value": 0, "unit": "containers"},
  {"name": "paused",   "value": 0, "unit": "containers"},
  {"name": "total",    "value": 0, "unit": "containers"}
]
EOF
    exit 0
fi

RUNNING=$(docker ps -q --filter "status=running"    2>/dev/null | wc -l | tr -d ' ')
STOPPED=$(docker ps -q --filter "status=exited"     2>/dev/null | wc -l | tr -d ' ')
PAUSED=$(docker ps  -q --filter "status=paused"     2>/dev/null | wc -l | tr -d ' ')
TOTAL=$(docker ps   -qa                             2>/dev/null | wc -l | tr -d ' ')

cat <<EOF
[
  {"name": "running",  "value": ${RUNNING:-0}, "unit": "containers"},
  {"name": "stopped",  "value": ${STOPPED:-0}, "unit": "containers"},
  {"name": "paused",   "value": ${PAUSED:-0},  "unit": "containers"},
  {"name": "total",    "value": ${TOTAL:-0},   "unit": "containers"}
]
EOF