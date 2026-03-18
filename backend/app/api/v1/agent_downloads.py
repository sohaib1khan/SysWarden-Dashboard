"""
Agent Downloads — serve pre-built agent binaries and the install script.

Files are stored in /app/data/agent-bin/ (bind-mounted from ./data/agent-bin on host).
Only explicitly whitelisted filenames may be served (path-traversal safe).
"""
from __future__ import annotations

import pathlib

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(tags=["agent-downloads"])

AGENT_BIN_DIR = pathlib.Path("/app/data/agent-bin")

# Only these filenames are ever served — nothing else, no path traversal possible.
ALLOWED_FILES: dict[str, str] = {
    "agent-linux-amd64":        "application/octet-stream",
    "agent-linux-amd64-static": "application/octet-stream",
    "agent-linux-arm64":        "application/octet-stream",
    "agent-darwin-amd64":       "application/octet-stream",
    "agent-darwin-arm64":       "application/octet-stream",
    "agent-windows-amd64.exe":  "application/octet-stream",
    "install.sh":               "application/x-sh",
}


@router.get("/agent/downloads", summary="List available agent builds")
def list_downloads() -> list[dict]:
    """Return which downloadable files are actually present on disk."""
    if not AGENT_BIN_DIR.exists():
        return []
    results = []
    for name, media in ALLOWED_FILES.items():
        path = AGENT_BIN_DIR / name
        if path.is_file():
            results.append({
                "name": name,
                "size": path.stat().st_size,
                "media_type": media,
            })
    return results


@router.get("/agent/download/{filename}", summary="Download an agent file")
def download_file(filename: str) -> FileResponse:
    """Serve a single agent binary or the install script."""
    if filename not in ALLOWED_FILES:
        raise HTTPException(status_code=404, detail="File not found")
    path = AGENT_BIN_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not available yet — check back soon")
    return FileResponse(
        path=str(path),
        media_type=ALLOWED_FILES[filename],
        filename=filename,
    )
