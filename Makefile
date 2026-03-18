# SysWarden — Agent Build Helper
#
# All agent binaries are compiled directly into ./data/agent-bin/
# which is the same directory served for download by the backend.
# There is ONE place to look: data/agent-bin/
#
# Usage:
#   make               — build amd64 + static + sync install.sh (default)
#   make build-agent   — amd64 binary only
#   make build-static  — static (CGO_ENABLED=0) amd64 binary only
#   make build-arm64   — arm64 cross-compile
#   make build-all     — all of the above
#   make sync-install  — copy scripts/install.sh → data/agent-bin/install.sh
#   make clean-bins    — remove compiled binaries from data/agent-bin/
#
# ─────────────────────────────────────────────────────────────────────────────

AGENT_SRC    := ./agent
OUT_DIR      := ./data/agent-bin
INSTALL_SRC  := ./scripts/install.sh

.DEFAULT_GOAL := build

.PHONY: build build-agent build-static build-arm64 build-all sync-install clean-bins help

## Default: amd64 + static + sync install.sh
build: build-agent build-static sync-install

## Build linux-amd64 agent → data/agent-bin/agent-linux-amd64
build-agent:
	@mkdir -p $(OUT_DIR)
	cd $(AGENT_SRC) && go build -o ../$(OUT_DIR)/agent-linux-amd64 ./cmd/agent/
	@echo "✅ $(OUT_DIR)/agent-linux-amd64"

## Build fully-static linux-amd64 agent → data/agent-bin/agent-linux-amd64-static
build-static:
	@mkdir -p $(OUT_DIR)
	cd $(AGENT_SRC) && CGO_ENABLED=0 go build -ldflags="-extldflags=-static" \
	  -o ../$(OUT_DIR)/agent-linux-amd64-static ./cmd/agent/
	@echo "✅ $(OUT_DIR)/agent-linux-amd64-static"

## Cross-compile arm64 → data/agent-bin/agent-linux-arm64
build-arm64:
	@mkdir -p $(OUT_DIR)
	cd $(AGENT_SRC) && GOARCH=arm64 CGO_ENABLED=0 go build \
	  -o ../$(OUT_DIR)/agent-linux-arm64 ./cmd/agent/
	@echo "✅ $(OUT_DIR)/agent-linux-arm64"

## Build every supported variant (amd64 + static + arm64 + install.sh)
build-all: build-agent build-static build-arm64 sync-install
	@echo ""
	@echo "🎯 All binaries ready:"
	@ls -lh $(OUT_DIR)/

## Sync scripts/install.sh → data/agent-bin/install.sh
sync-install:
	@mkdir -p $(OUT_DIR)
	@cp $(INSTALL_SRC) $(OUT_DIR)/install.sh
	@echo "✅ $(OUT_DIR)/install.sh synced from $(INSTALL_SRC)"

## Remove compiled binaries from data/agent-bin/ (leaves install.sh and DB)
clean-bins:
	@rm -f $(OUT_DIR)/agent-linux-* $(OUT_DIR)/agent-darwin-* $(OUT_DIR)/agent-windows-*
	@echo "🗑️  Binaries removed from $(OUT_DIR)/"

## Show available targets
help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/## /  /'
