#!/bin/bash
# SysWarden Agent — Install / Manage Script
# Usage: sudo bash install.sh {install|uninstall|reinstall|status|logs}
#
# The script is self-contained: if the agent binary is not found locally it
# will be downloaded automatically from SYSWARDEN_BACKEND_URL.
# Minimal one-liner install (no separate binary download needed):
#
#   curl -fLO https://YOUR-BACKEND-URL/api/v1/agent/download/install.sh
#   SYSWARDEN_BACKEND_URL=https://YOUR-BACKEND-URL sudo bash install.sh install
#
# On RHEL 8 / CentOS / AlmaLinux / Rocky (old glibc) the static binary is
# selected automatically.  Force it explicitly with SYSWARDEN_STATIC=1.
# Force the regular dynamic binary with SYSWARDEN_STATIC=0.

# ── Auto-detect the real user (works even when run with sudo) ──────────────────
REAL_USER="${SUDO_USER:-$USER}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)

# ── Arch + glibc detection ────────────────────────────────────────────────────
# Split into two functions for clarity and testability.

# Returns 0 if the static binary is needed, 1 if the dynamic binary is fine.
_needs_static() {
    # Explicit override always wins
    [ "${SYSWARDEN_STATIC:-}" = "1" ] && return 0
    [ "${SYSWARDEN_STATIC:-}" = "0" ] && return 1

    # ── 1. OS family check via grep (never sources the file — avoids subshell
    #       variable-expansion quirks that can silently return empty on some 
    #       RHEL/CentOS/AlmaLinux configurations) ─────────────────────────────
    if [ -f /etc/os-release ]; then
        if grep -qiE '^(ID|ID_LIKE)=.*"?(rhel|centos|almalinux|rocky|ol)"?' \
               /etc/os-release 2>/dev/null; then
            return 0
        fi
    fi

    # ── 2. glibc version check — static needed if glibc < 2.31 ──────────────
    local glibcver=""

    # getconf is the most reliable source: outputs "glibc 2.28"
    if command -v getconf >/dev/null 2>&1; then
        glibcver=$(getconf GNU_LIBC_VERSION 2>/dev/null) || glibcver=""
    fi

    # Fallback: ldd --version outputs "ldd (GNU libc) 2.28" on the first line
    if [ -z "$glibcver" ] && command -v ldd >/dev/null 2>&1; then
        glibcver=$(ldd --version 2>/dev/null | head -1) || glibcver=""
    fi

    if [ -n "$glibcver" ]; then
        # Extract the version number regardless of where it sits in the string
        local ver major minor
        ver=$(printf '%s' "$glibcver" | grep -oE '[0-9]+\.[0-9]+' | head -1)
        if [ -n "$ver" ]; then
            major=$(printf '%s' "$ver" | cut -d. -f1)
            minor=$(printf '%s' "$ver" | cut -d. -f2)
            if [ "$major" -lt 2 ] 2>/dev/null || \
               { [ "$major" -eq 2 ] 2>/dev/null && [ "$minor" -lt 31 ] 2>/dev/null; }; then
                return 0
            fi
        fi
    fi

    return 1
}

_detect_binary_name() {
    local arch suffix
    arch=$(uname -m)
    case "$arch" in
        aarch64|arm64) suffix="arm64" ;;
        *)             suffix="amd64" ;;
    esac

    if [ "$suffix" = "amd64" ] && _needs_static; then
        echo "agent-linux-amd64-static"
    else
        echo "agent-linux-$suffix"
    fi
}
BINARY_NAME="$(_detect_binary_name)"

# ── Auto-detect the agent binary (searches common locations) ──────────────────
find_agent_binary() {
    # Search for the detected binary name AND its static counterpart so that
    # a previously-downloaded binary is found regardless of which variant it is.
    local names=("$BINARY_NAME")
    [ "$BINARY_NAME" = "agent-linux-amd64" ] && names+=("agent-linux-amd64-static")
    [ "$BINARY_NAME" = "agent-linux-amd64-static" ] && names+=("agent-linux-amd64")

    for name in "${names[@]}"; do
        for dir in "Download" "Downloads" "SysWarden/agent/bin" "SysWarden/agent" "."; do
            local candidate="$REAL_HOME/$dir/$name"
            if [ -f "$candidate" ]; then
                echo "$candidate"
                return
            fi
        done
        if [ -f "./$name" ]; then
            echo "$(pwd)/$name"
            return
        fi
    done
    echo ""
}

# ── Config ─────────────────────────────────────────────────────────────────────
BACKEND_URL="${SYSWARDEN_BACKEND_URL:-https://YOUR-BACKEND-URL}"
INTERVAL="${SYSWARDEN_INTERVAL:-10}"
SERVICE_NAME="syswarden-agent"
INSTALL_PATH="/usr/local/bin/syswarden-agent"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
AGENT_BINARY="${SYSWARDEN_BINARY:-$(find_agent_binary)}"
# Temp dir for auto-downloaded binary (cleaned up on exit)
_TMP_DIR=""
_cleanup() { [ -n "$_TMP_DIR" ] && rm -rf "$_TMP_DIR"; }
trap _cleanup EXIT

# ── Auto-download the agent binary ───────────────────────────────────────────
download_agent() {
    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
        echo "❌ curl or wget is required. Install one and retry."
        exit 1
    fi
    local url="${BACKEND_URL}/api/v1/agent/download/${BINARY_NAME}"
    _TMP_DIR=$(mktemp -d /tmp/syswarden-install-XXXXXX)
    local dest="${_TMP_DIR}/${BINARY_NAME}"
    echo "📥 Downloading latest agent for $(uname -m) ..."
    echo "   Source : $url"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --progress-bar -o "$dest" "$url" || { echo "❌ Download failed."; exit 1; }
    else
        wget -q --show-progress -O "$dest" "$url" || { echo "❌ Download failed."; exit 1; }
    fi
    chmod +x "$dest"
    AGENT_BINARY="$dest"
    echo "✅ Agent downloaded."
}
# ── Helpers ────────────────────────────────────────────────────────────────────
check_root() {
    if [ "$EUID" -ne 0 ]; then
        echo "❌ Please run with sudo: sudo bash $0 $1"
        exit 1
    fi
}

check_binary() {
    if [ -z "$AGENT_BINARY" ] || [ ! -f "$AGENT_BINARY" ]; then
        echo "🔍 Binary not found locally — downloading from $BACKEND_URL ..."
        download_agent
    fi
}

print_config() {
    echo ""
    echo "   User        : $REAL_USER"
    echo "   Home        : $REAL_HOME"
    echo "   Binary      : $AGENT_BINARY"
    echo "   Variant     : $BINARY_NAME"
    echo "   Backend     : $BACKEND_URL"
    echo "   Install to  : $INSTALL_PATH"
    echo ""
}

# ── Commands ───────────────────────────────────────────────────────────────────
install() {
    check_root install
    check_binary

    echo "📦 Installing SysWarden Agent..."
    print_config

    cp "$AGENT_BINARY" "$INSTALL_PATH"
    chmod +x "$INSTALL_PATH"

    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=SysWarden Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$REAL_USER
Environment="HOME=$REAL_HOME"
Environment="SYSWARDEN_BACKEND_URL=$BACKEND_URL"
Environment="SYSWARDEN_INTERVAL=$INTERVAL"
ExecStart=$INSTALL_PATH
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"

    echo "✅ Agent installed and running!"
    echo ""
    echo "   Check status : sudo bash $0 status"
    echo "   Watch logs   : sudo bash $0 logs"
}

uninstall() {
    check_root uninstall
    echo "🗑️  Removing SysWarden Agent..."
    systemctl stop "$SERVICE_NAME"    2>/dev/null
    systemctl disable "$SERVICE_NAME" 2>/dev/null
    rm -f "$SERVICE_FILE"
    rm -f "$INSTALL_PATH"
    systemctl daemon-reload
    echo "✅ Agent removed!"
}

reinstall() {
    check_root reinstall
    echo "🔄 Reinstalling SysWarden Agent..."
    # Force a fresh download of the latest binary
    AGENT_BINARY=""
    download_agent
    uninstall
    sleep 1
    install
}

status() { systemctl status "$SERVICE_NAME"; }
logs()   { journalctl -u "$SERVICE_NAME" -f; }

# ── Entrypoint ─────────────────────────────────────────────────────────────────
case "$1" in
    install)   install ;;
    uninstall) uninstall ;;
    reinstall) reinstall ;;
    status)    status ;;
    logs)      logs ;;
    *)
        echo ""
        echo "Usage: sudo bash $0 {install|uninstall|reinstall|status|logs}"
        echo ""
        echo "Options:"
        echo "  install    — download latest binary, create systemd service, start on boot"
        echo "  uninstall  — stop service, remove binary and service file"
        echo "  reinstall  — download latest binary, uninstall then install cleanly"
        echo "  status     — show service status"
        echo "  logs       — stream live logs"
        echo ""
        echo "Overrides (optional env vars before sudo):"
        echo "  SYSWARDEN_BINARY       — path to agent binary (auto-downloaded if omitted)"
        echo "  SYSWARDEN_BACKEND_URL  — backend URL  (default: https://YOUR-BACKEND-URL)"
        echo "  SYSWARDEN_INTERVAL     — metric push interval in seconds  (default: 10)"
        echo "  SYSWARDEN_STATIC=1     — force static binary (RHEL/CentOS/AlmaLinux/old glibc)"
        echo "  SYSWARDEN_STATIC=0     — force dynamic binary (modern distros)"
        echo "  (auto-detected by default: RHEL-family and glibc < 2.31 get static build)"
        echo ""
        echo "Quickstart (no binary download needed):"
        echo "  curl -fLO https://YOUR-BACKEND-URL/api/v1/agent/download/install.sh"
        echo "  SYSWARDEN_BACKEND_URL=https://YOUR-BACKEND-URL sudo bash $0 install"
        echo ""
        echo "Force static on RHEL / AlmaLinux / old-glibc systems:"
        echo "  SYSWARDEN_STATIC=1 SYSWARDEN_BACKEND_URL=https://YOUR-BACKEND-URL sudo bash $0 install"
        echo ""
        exit 1
        ;;
esac
