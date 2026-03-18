#!/usr/bin/env python3
# PLUGIN_NAME: proxmox_list_vms
# PLUGIN_TYPE: capability
# PLUGIN_CAPABILITY: proxmox.list_vms
# PLUGIN_VERSION: 2.0.0
# PLUGIN_DESCRIPTION: List all VMs and LXC containers across all Proxmox nodes
# PLUGIN_AUTHOR: SysWarden
#
# ── Two operating modes (auto-detected) ──────────────────────────────────────
#
#   MODE 1 — On-node (agent running ON the Proxmox host)
#     Uses the `pvesh` CLI which ships with every Proxmox VE installation.
#     No credentials needed — pvesh uses the local unix socket as root.
#     Auto-detected when `pvesh` is found in PATH.
#
#   MODE 2 — Remote (agent running on a separate management host)
#     Uses the Proxmox REST API over HTTPS with an API token.
#     Required environment variables:
#       PROXMOX_HOST          IP or hostname of the Proxmox node (no port)
#       PROXMOX_TOKEN_ID      user@realm!tokenid  e.g. root@pam!syswarden
#       PROXMOX_TOKEN_SECRET  UUID secret for that token
#     Optional:
#       PROXMOX_VERIFY_TLS    Set to "1" to enable TLS cert verification
#                             (default off — Proxmox ships self-signed certs)
#
# ── Optional params (sent as JSON on stdin from the dashboard) ────────────────
#   node    — filter to a specific node name     (default: all nodes)
#   type    — "qemu" | "lxc" | "all"             (default: "all")
#   status  — "running" | "stopped" | "all"       (default: "all")
#
# ── Output (JSON to stdout) ──────────────────────────────────────────────────
#   {
#     "mode":          "local" | "remote",
#     "total":         <int>,
#     "nodes_queried": [<str>, ...],
#     "vms": [
#       {
#         "node":       <str>,
#         "vmid":       <int>,
#         "name":       <str>,
#         "type":       "qemu" | "lxc",
#         "status":     "running" | "stopped" | ...,
#         "cpu_pct":    <float>,
#         "mem_mb":     <float>,
#         "maxmem_mb":  <float>,
#         "disk_gb":    <float>,
#         "uptime_sec": <int>
#       }, ...
#     ]
#   }
# ─────────────────────────────────────────────────────────────────────────────

import json
import os
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.request

HTTP_TIMEOUT = 10   # seconds — must stay well under agent maxRunTimeout (30 s)
PROXMOX_PORT = 8006


def die(msg):
    print(json.dumps({"error": msg}))
    sys.exit(1)


# ── pvesh helpers (MODE 1 — on-node, no credentials) ─────────────────────────

def pvesh_get(path):
    result = subprocess.run(
        ["pvesh", "get", path, "--output-format", "json"],
        capture_output=True, text=True, timeout=HTTP_TIMEOUT,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "pvesh exited {}".format(result.returncode))
    return json.loads(result.stdout)


def collect_local(filter_node, filter_type, filter_status):
    nodes_raw = pvesh_get("/nodes")
    nodes = [n["node"] for n in nodes_raw if not filter_node or n["node"] == filter_node]
    if not nodes:
        die("Node '{}' not found".format(filter_node) if filter_node else "No nodes returned by pvesh")

    results, errors = [], []
    for node in nodes:
        if filter_type in ("all", "qemu"):
            try:
                for vm in pvesh_get("/nodes/{}/qemu".format(node)):
                    st = vm.get("status", "unknown")
                    if filter_status != "all" and st != filter_status:
                        continue
                    results.append(_row(node, vm, "qemu"))
            except Exception as exc:
                errors.append({"node": node, "type": "qemu", "error": str(exc)})

        if filter_type in ("all", "lxc"):
            try:
                for ct in pvesh_get("/nodes/{}/lxc".format(node)):
                    st = ct.get("status", "unknown")
                    if filter_status != "all" and st != filter_status:
                        continue
                    results.append(_row(node, ct, "lxc"))
            except Exception as exc:
                errors.append({"node": node, "type": "lxc", "error": str(exc)})

    out = {"mode": "local", "total": len(results), "nodes_queried": nodes, "vms": results}
    if errors:
        out["errors"] = errors
    return out


# ── REST API helpers (MODE 2 — remote agent) ─────────────────────────────────

def build_ssl_ctx():
    ctx = ssl.create_default_context()
    if os.environ.get("PROXMOX_VERIFY_TLS", "0").strip() != "1":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


def api_get(base_url, path, auth, ctx):
    req = urllib.request.Request("{}{}".format(base_url, path), headers={"Authorization": auth})
    with urllib.request.urlopen(req, context=ctx, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode())["data"]


def collect_remote(filter_node, filter_type, filter_status):
    host = os.environ.get("PROXMOX_HOST", "").strip().rstrip("/")
    token_id = os.environ.get("PROXMOX_TOKEN_ID", "").strip()
    token_secret = os.environ.get("PROXMOX_TOKEN_SECRET", "").strip()

    if not host:
        die("pvesh not found and PROXMOX_HOST is not set. "
            "Either run the agent on the Proxmox host (pvesh auto-detected), "
            "or set PROXMOX_HOST + PROXMOX_TOKEN_ID + PROXMOX_TOKEN_SECRET for remote access.")
    if not token_id:
        die("PROXMOX_TOKEN_ID is not set (format: user@realm!tokenid)")
    if not token_secret:
        die("PROXMOX_TOKEN_SECRET is not set")

    base_url = "https://{}:{}/api2/json".format(host, PROXMOX_PORT)
    auth = "PVEAPIToken={}={}".format(token_id, token_secret)
    ctx = build_ssl_ctx()

    try:
        nodes_raw = api_get(base_url, "/nodes", auth, ctx)
    except urllib.error.URLError as exc:
        die("Cannot reach {}:{} - {}".format(host, PROXMOX_PORT, exc.reason))
    except urllib.error.HTTPError as exc:
        die("Proxmox API {}: {} - check token permissions".format(exc.code, exc.reason))
    except Exception as exc:
        die("Unexpected error: {}".format(exc))

    nodes = [n["node"] for n in nodes_raw if not filter_node or n["node"] == filter_node]
    if not nodes:
        die("Node {} not found".format(filter_node) if filter_node else "No nodes returned")

    results, errors = [], []
    for node in nodes:
        if filter_type in ("all", "qemu"):
            try:
                for vm in api_get(base_url, "/nodes/{}/qemu".format(node), auth, ctx):
                    st = vm.get("status", "unknown")
                    if filter_status != "all" and st != filter_status:
                        continue
                    results.append(_row(node, vm, "qemu"))
            except Exception as exc:
                errors.append({"node": node, "type": "qemu", "error": str(exc)})

        if filter_type in ("all", "lxc"):
            try:
                for ct in api_get(base_url, "/nodes/{}/lxc".format(node), auth, ctx):
                    st = ct.get("status", "unknown")
                    if filter_status != "all" and st != filter_status:
                        continue
                    results.append(_row(node, ct, "lxc"))
            except Exception as exc:
                errors.append({"node": node, "type": "lxc", "error": str(exc)})

    out = {"mode": "remote", "total": len(results), "nodes_queried": nodes, "vms": results}
    if errors:
        out["errors"] = errors
    return out


def _row(node, item, kind):
    return {
        "node":       node,
        "vmid":       item.get("vmid"),
        "name":       item.get("name") or "{}-{}".format(kind, item.get("vmid")),
        "type":       kind,
        "status":     item.get("status", "unknown"),
        "cpu_pct":    round(item.get("cpu", 0) * 100, 2),
        "mem_mb":     round(item.get("mem", 0) / 1048576, 1),
        "maxmem_mb":  round(item.get("maxmem", 0) / 1048576, 1),
        "disk_gb":    round(item.get("disk", 0) / 1073741824, 2),
        "uptime_sec": item.get("uptime", 0),
    }


def main():
    params = {}
    try:
        raw = sys.stdin.read().strip()
        if raw:
            params = json.loads(raw)
    except Exception:
        pass

    filter_node = params.get("node", "")
    filter_type = params.get("type", "all")
    filter_status = params.get("status", "all")

    if shutil.which("pvesh"):
        output = collect_local(filter_node, filter_type, filter_status)
    else:
        output = collect_remote(filter_node, filter_type, filter_status)

    print(json.dumps(output))


if __name__ == "__main__":
    main()
