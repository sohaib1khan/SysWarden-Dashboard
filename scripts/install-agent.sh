#!/usr/bin/env bash
# install-agent.sh — One-command agent installer for Linux/macOS
#
# Usage:
#   SYSWARDEN_BACKEND_URL=http://192.168.1.10:8000 bash install-agent.sh
#
# Options (env vars):
#   SYSWARDEN_BACKEND_URL   Backend URL (prompted if not set)
#   INSTALL_DIR             Binary destination   (default: /usr/local/bin)
#   INSTALL_SYSTEMD         Set to "1" to also install a systemd service (Linux only)
#   SYSWARDEN_INTERVAL      Metric push interval in seconds (default: 10)

set -euo pipefail

# TODO: update this to your actual GitHub repo path (user/repo) before distributing
REPO="https://github.com/sohaib1khan/SysWarden-Dashboard.git"
AGENT_SUBDIR="agent"   # subfolder inside the repo that contains go.mod
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"
BINARY="syswarden-agent"
INTERVAL="${SYSWARDEN_INTERVAL:-10}"

echo "==> SysWarden Agent Installer"

# Require Go
if ! command -v go &>/dev/null; then
  echo "ERROR: Go is not installed. Install Go 1.22+ and re-run." >&2
  exit 1
fi

# Require SYSWARDEN_BACKEND_URL
if [[ -z "${SYSWARDEN_BACKEND_URL:-}" ]]; then
  read -rp "Backend URL (e.g. http://192.168.1.10:8000): " SYSWARDEN_BACKEND_URL
  export SYSWARDEN_BACKEND_URL
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

echo "==> Cloning & building agent…"
git clone --depth 1 "https://${REPO}" "$TMP/agent"
cd "$TMP/agent"
go mod download
go build -ldflags="-s -w" -o "$TMP/$BINARY" ./cmd/agent

echo "==> Installing to $INSTALL_DIR/$BINARY"
install -m 755 "$TMP/$BINARY" "$INSTALL_DIR/$BINARY"

# ── Optional systemd service ─────────────────────────────────────────────────
if [[ "${INSTALL_SYSTEMD:-0}" == "1" ]] && command -v systemctl &>/dev/null; then
  SERVICE_FILE="/etc/systemd/system/syswarden-agent.service"
  echo "==> Installing systemd service to $SERVICE_FILE"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=SysWarden Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
Environment="SYSWARDEN_BACKEND_URL=${SYSWARDEN_BACKEND_URL}"
Environment="SYSWARDEN_INTERVAL=${INTERVAL}"
ExecStart=${INSTALL_DIR}/${BINARY}
Restart=always
RestartSec=15
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable syswarden-agent
  systemctl start  syswarden-agent

  echo ""
  echo "✅ Done! Service status:"
  systemctl status syswarden-agent --no-pager
else
  echo ""
  echo "✅ Done! Run the agent with:"
  echo "   SYSWARDEN_BACKEND_URL=$SYSWARDEN_BACKEND_URL $INSTALL_DIR/$BINARY"
  echo ""
  echo "   To install as a systemd service, re-run with:"
  echo "   INSTALL_SYSTEMD=1 SYSWARDEN_BACKEND_URL=$SYSWARDEN_BACKEND_URL bash install-agent.sh"
fi
