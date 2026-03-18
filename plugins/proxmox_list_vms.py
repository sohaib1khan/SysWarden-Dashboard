#!/usr/bin/env python3
# PLUGIN_NAME: proxmox_list_vms
# PLUGIN_TYPE: capability
# PLUGIN_CAPABILITY: proxmox.list_vms
# PLUGIN_VERSION: 1.0.0
# PLUGIN_DESCRIPTION: List all VMs and LXC containers across all Proxmox nodes
# PLUGIN_AUTHOR: SysWarden
#
# ── Required environment variables (set on the agent host) ───────────────────
#   PROXMOX_HOST          Proxmox hostname or IP (no port, no trailing slash)
#                         e.g.  192.168.1.100   or   proxmox.lan
#   PROXMOX_TOKEN_ID      API token identifier in the form USER@REALM!TOKENID
#                         e.g.  root@pam!syswarden
#   PROXMOX_TOKEN_SECRET  The UUID secret for that token
#                         e.g.  xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
#
# ── Optional params (sent as JSON on stdin from the dashboard) ────────────────
#   node    — filter to a specific node name     (default: all nodes)
#   type    — "qemu" | "lxc" | "all"             (default: "all")
#   status  — "running" | "stopped" | "all"       (default: "all")
#
# ── Output (JSON to stdout) ──────────────────────────────────────────────────
#   {
#     "total": <int>,
#     "nodes_queried": [<str>, ...],
#     "vms": [
#       {
#         "node":       <str>,
#         "vmid":       <int>,
#         "name":       <str>,
#         "type":       "qemu" | "lxc",
#         "status":     "running" | "stopped" | ...,
#         "cpu_pct":    <float>,    # 0-100
#         "mem_mb":     <float>,    # current RSS
#         "maxmem_mb":  <float>,    # configured max
#         "disk_gb":    <float>,
#         "uptime_sec": <int>
#       },
#       ...
#     ]
#   }
#
# ── Security notes ────────────────────────────────────────────────────────────
#   • Credentials come only from environment variables, never from params, so
#     they are never transmitted over the WebSocket.
#   • TLS certificate verification is intentionally disabled because Proxmox VE
#     ships with a self-signed certificate by default. If you have a valid cert
#     (e.g. via Let's Encrypt in Proxmox), set PROXMOX_VERIFY_TLS=1 to enable
#     verification.
# ─────────────────────────────────────────────────────────────────────────────

import json
import os
import sys
import ssl
import urllib.request
import urllib.error

# Must be well under the agent's maxRunTimeout (30 s)
HTTP_TIMEOUT = 10
PROXMOX_PORT = 8006


def die(msg: str) -> None:
    """Print an error JSON object to stdout and exit non-zero."""
    print(json.dumps({"error": msg}))
    sys.exit(1)


def build_ssl_context() -> ssl.SSLContext:
    verify = os.environ.get("PROXMOX_VERIFY_TLS", "0").strip() == "1"
    ctx = ssl.create_default_context()
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def api_get(base_url: str, path: str, auth_header: str, ssl_ctx: ssl.SSLContext) -> object:
    url = f"{base_url}{path}"
    req = urllib.request.Request(url, headers={"Authorization": auth_header})
    with urllib.request.urlopen(req, context=ssl_ctx, timeout=HTTP_TIMEOUT) as resp:
        return json.loads(resp.read().decode())["data"]


def main() -> None:
    # ── Credentials from environment ──────────────────────────────────────────
    host = os.environ.get("PROXMOX_HOST", "").strip().rstrip("/")
    token_id = os.environ.get("PROXMOX_TOKEN_ID", "").strip()
    token_secret = os.environ.get("PROXMOX_TOKEN_SECRET", "").strip()

    if not host:
        die("PROXMOX_HOST is not set")
    if not token_id:
        die("PROXMOX_TOKEN_ID is not set (expected format: user@realm!tokenid)")
    if not token_secret:
        die("PROXMOX_TOKEN_SECRET is not set")

    # ── Optional params from stdin (dashboard request) ────────────────────────
    params: dict = {}
    try:
        raw = sys.stdin.read().strip()
        if raw:
            params = json.loads(raw)
    except Exception:
        pass  # No params is fine

    filter_node: str = params.get("node", "")
    filter_type: str = params.get("type", "all")   # qemu | lxc | all
    filter_status: str = params.get("status", "all")  # running | stopped | all

    # ── Setup ─────────────────────────────────────────────────────────────────
    base_url = f"https://{host}:{PROXMOX_PORT}/api2/json"
    # Proxmox API token auth header format: PVEAPIToken=USER@REALM!TOKENID=SECRET
    auth_header = f"PVEAPIToken={token_id}={token_secret}"
    ssl_ctx = build_ssl_context()

    # ── Fetch node list ───────────────────────────────────────────────────────
    try:
        nodes_data = api_get(base_url, "/nodes", auth_header, ssl_ctx)
    except urllib.error.URLError as exc:
        die(f"Cannot reach Proxmox at {host}:{PROXMOX_PORT} — {exc.reason}")
    except urllib.error.HTTPError as exc:
        die(f"Proxmox API error {exc.code}: {exc.reason} — check token permissions")
    except Exception as exc:
        die(f"Unexpected error fetching nodes: {exc}")

    nodes = [n["node"] for n in nodes_data if not filter_node or n["node"] == filter_node]

    if not nodes:
        msg = f"Node '{filter_node}' not found" if filter_node else "No nodes returned by Proxmox"
        die(msg)

    # ── Collect VMs and containers from each node ─────────────────────────────
    results = []
    errors = []

    for node in nodes:
        # QEMU virtual machines
        if filter_type in ("all", "qemu"):
            try:
                vms = api_get(base_url, f"/nodes/{node}/qemu", auth_header, ssl_ctx)
                for vm in vms:
                    status = vm.get("status", "unknown")
                    if filter_status != "all" and status != filter_status:
                        continue
                    results.append({
                        "node":       node,
                        "vmid":       vm.get("vmid"),
                        "name":       vm.get("name") or f"vm-{vm.get('vmid')}",
                        "type":       "qemu",
                        "status":     status,
                        "cpu_pct":    round(vm.get("cpu", 0) * 100, 2),
                        "mem_mb":     round(vm.get("mem", 0) / 1024 / 1024, 1),
                        "maxmem_mb":  round(vm.get("maxmem", 0) / 1024 / 1024, 1),
                        "disk_gb":    round(vm.get("disk", 0) / 1024 / 1024 / 1024, 2),
                        "uptime_sec": vm.get("uptime", 0),
                    })
            except Exception as exc:
                errors.append({"node": node, "type": "qemu", "error": str(exc)})

        # LXC containers
        if filter_type in ("all", "lxc"):
            try:
                lxcs = api_get(base_url, f"/nodes/{node}/lxc", auth_header, ssl_ctx)
                for ct in lxcs:
                    status = ct.get("status", "unknown")
                    if filter_status != "all" and status != filter_status:
                        continue
                    results.append({
                        "node":       node,
                        "vmid":       ct.get("vmid"),
                        "name":       ct.get("name") or f"ct-{ct.get('vmid')}",
                        "type":       "lxc",
                        "status":     status,
                        "cpu_pct":    round(ct.get("cpu", 0) * 100, 2),
                        "mem_mb":     round(ct.get("mem", 0) / 1024 / 1024, 1),
                        "maxmem_mb":  round(ct.get("maxmem", 0) / 1024 / 1024, 1),
                        "disk_gb":    round(ct.get("disk", 0) / 1024 / 1024 / 1024, 2),
                        "uptime_sec": ct.get("uptime", 0),
                    })
            except Exception as exc:
                errors.append({"node": node, "type": "lxc", "error": str(exc)})

    output: dict = {
        "total":         len(results),
        "nodes_queried": nodes,
        "vms":           results,
    }
    if errors:
        output["errors"] = errors

    print(json.dumps(output))


if __name__ == "__main__":
    main()
