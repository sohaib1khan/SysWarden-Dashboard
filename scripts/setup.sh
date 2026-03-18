#!/usr/bin/env bash
# setup.sh — First-run environment bootstrapper for SysWarden
#
# What it does:
#   1. Skips silently if .env already exists (safe to re-run)
#   2. Generates a cryptographically random SECRET_KEY (64-char hex)
#   3. Auto-detects the host's LAN IP for ALLOWED_ORIGINS
#   4. Writes a ready-to-use .env file
#
# Usage:
#   bash scripts/setup.sh          # interactive (prompts for IP if unsure)
#   bash scripts/setup.sh --yes    # non-interactive (use auto-detected IP)
#   make setup                     # same as above via Makefile

set -euo pipefail

ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"
EXAMPLE_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.example"

# ── Already set up? ──────────────────────────────────────────────────────────
if [[ -f "$ENV_FILE" ]]; then
    echo "✅ .env already exists — skipping setup."
    echo "   Delete it and re-run if you want to regenerate."
    exit 0
fi

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║        SysWarden — First-run Setup               ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Generate SECRET_KEY ──────────────────────────────────────────────────────
if command -v python3 &>/dev/null; then
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
elif command -v openssl &>/dev/null; then
    SECRET_KEY=$(openssl rand -hex 32)
else
    echo "ERROR: python3 or openssl is required to generate a secret key." >&2
    exit 1
fi

# ── Detect LAN IP ────────────────────────────────────────────────────────────
detect_ip() {
    # Try ip route first (Linux), then ifconfig fallback (macOS/BSD)
    if command -v ip &>/dev/null; then
        ip route get 1.1.1.1 2>/dev/null | awk '/src/{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}'
    elif command -v ipconfig &>/dev/null; then
        ipconfig getifaddr en0 2>/dev/null || true
    fi
}

DETECTED_IP=$(detect_ip || true)

if [[ "${1:-}" == "--yes" ]]; then
    HOST_INPUT="${DETECTED_IP:-localhost}"
else
    if [[ -n "$DETECTED_IP" ]]; then
        read -rp "Dashboard host IP or full URL [$DETECTED_IP]: " HOST_INPUT
        HOST_INPUT="${HOST_INPUT:-$DETECTED_IP}"
    else
        read -rp "Dashboard host IP or full URL (e.g. 192.168.1.50 or https://example.com): " HOST_INPUT
        : "${HOST_INPUT:?Cannot be empty}"
    fi
fi

# ── Build ALLOWED_ORIGINS and display URL ────────────────────────────────────
# If the user entered a full URL (contains "://"), use it as-is.
# If they entered a bare IP or hostname, build http://<host>:<port>.
DASHBOARD_PORT="${DASHBOARD_PORT:-5173}"

if [[ "$HOST_INPUT" == *"://"* ]]; then
    # Strip any trailing slash — use the URL directly, no port appended
    ALLOWED_ORIGINS="${HOST_INPUT%/}"
    DISPLAY_URL="${ALLOWED_ORIGINS}"
else
    ALLOWED_ORIGINS="http://${HOST_INPUT}:${DASHBOARD_PORT}"
    DISPLAY_URL="${ALLOWED_ORIGINS}"
fi

# Extract just the host portion for the agent install command
HOST_IP="${HOST_INPUT%/}"

# ── Write .env ───────────────────────────────────────────────────────────────
# Start from the example file so any new keys added later are included,
# then replace the two values we're generating/customising.
sed \
    -e "s|^SECRET_KEY=.*|SECRET_KEY=${SECRET_KEY}|" \
    -e "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=${ALLOWED_ORIGINS}|" \
    "$EXAMPLE_FILE" > "$ENV_FILE"

echo ""
echo "✅ .env created:"
echo "   SECRET_KEY      = ${SECRET_KEY:0:8}…  (64-char hex, truncated for display)"
echo "   ALLOWED_ORIGINS = ${ALLOWED_ORIGINS}"
echo ""
# ── Launch the stack ─────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
    echo "⚠️  Docker not found — skipping stack launch."
    echo "   Install Docker, then run:  docker compose up -d --build"
    exit 0
fi

COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null 2>&1; then
    # Older Docker installs use the standalone docker-compose binary
    if command -v docker-compose &>/dev/null; then
        COMPOSE_CMD="docker-compose"
    else
        echo "⚠️  docker compose plugin not found — skipping stack launch."
        echo "   Run manually:  docker compose up -d --build"
        exit 0
    fi
fi

# Move to the repo root (script lives in scripts/)
cd "$(dirname "$0")/.."

# ── Populate data/agent-bin/ ─────────────────────────────────────────────────
# The data/ directory is gitignored, so it doesn't exist on a fresh clone.
# We need at minimum install.sh there so the download endpoint works.
# We also build the agent binaries using Docker (no Go required on host).
echo "📦 Building agent binaries (uses Docker — no Go required)…"
mkdir -p data/agent-bin

# Always sync the install script
cp scripts/install.sh data/agent-bin/install.sh
echo "   ✅ install.sh → data/agent-bin/install.sh"

# Build agent binaries using the official Go image — no Go install needed
AGENT_BIN_DIR="$(pwd)/data/agent-bin"
AGENT_SRC="$(pwd)/agent"

_docker_build() {
    local outname="$1"; shift
    echo -n "   Building ${outname}… "
    if docker run --rm \
        -v "${AGENT_SRC}:/src" \
        -v "${AGENT_BIN_DIR}:/out" \
        -w /src \
        golang:1.22-alpine \
        sh -c "$*" > /tmp/sw_build_${outname}.log 2>&1; then
        echo "✅"
    else
        echo "⚠️  skipped (build failed — see /tmp/sw_build_${outname}.log)"
    fi
}

_docker_build "agent-linux-amd64" \
    "CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o /out/agent-linux-amd64 ./cmd/agent/"

_docker_build "agent-linux-amd64-static" \
    "CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w -extldflags=-static' -o /out/agent-linux-amd64-static ./cmd/agent/"

_docker_build "agent-linux-arm64" \
    "CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags='-s -w' -o /out/agent-linux-arm64 ./cmd/agent/"

echo ""

# ── Launch the stack ─────────────────────────────────────────────────────────
echo "🚀 Starting SysWarden stack (this builds images on first run, may take a minute)…"
echo ""
$COMPOSE_CMD up -d --build

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   ✅  SysWarden is up!                           ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "  Dashboard : ${DISPLAY_URL}"
echo ""
echo "  Register your admin account, then install agents on remote hosts:"
echo ""
echo "  curl -fsSL ${HOST_IP%/}/api/v1/agent/download/install.sh | \\"
echo "    SYSWARDEN_BACKEND_URL=${HOST_IP%/} sudo bash -s install"
echo ""
