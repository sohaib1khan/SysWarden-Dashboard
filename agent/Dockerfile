# ── Build stage ──────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

WORKDIR /build

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o syswarden-agent ./cmd/agent

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM alpine:3.19

# bash     — scripts use #!/bin/bash + set -euo pipefail
# curl     — http_status.sh
# openssl  — ssl_expiry.sh
# iputils  — ping_check.sh (provides /bin/ping)
# bc       — http_status.sh (floating-point arithmetic)
# python3  — Python capability plugins (e.g. proxmox_list_vms.py)
RUN apk add --no-cache ca-certificates bash curl openssl iputils bc python3

WORKDIR /app
COPY --from=builder /build/syswarden-agent .

# Bundle all plugin scripts; chmod so the loader can exec them
COPY plugins/ ./plugins/
RUN find ./plugins -maxdepth 1 -type f \( -name '*.sh' -o -name '*.py' \) -exec chmod +x {} \;

# Agent key / ID are persisted here.
# Mount a named volume or host path to keep credentials across restarts.
VOLUME ["/root/.syswarden"]

# ─────────────────────────────────────────────────────────────────────────────
# Environment variables (all optional — defaults shown):
#
#   SYSWARDEN_BACKEND_URL   Backend base URL          default: http://localhost:8000
#   SYSWARDEN_INTERVAL      Metric push interval (s)  default: 10
#   SYSWARDEN_AGENT_ID      Skip re-registration      (auto-populated after first run)
#   SYSWARDEN_API_KEY       Skip re-registration      (auto-populated after first run)
#
# Host metric access:
#   For CPU / memory / disk metrics inside Docker add:
#     --pid=host  --network=host
#     -v /proc:/host/proc:ro  -v /sys:/host/sys:ro
#   (gopsutil reads /proc by default; the above gives host-level numbers)
# ─────────────────────────────────────────────────────────────────────────────

ENTRYPOINT ["./syswarden-agent"]
