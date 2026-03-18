#!/usr/bin/env python3
"""
Entrypoint wrapper for the SysWarden backend container.

Runs briefly as root to fix bind-mount directory permissions on /app/data,
then drops privileges to the 'syswarden' user before exec-ing the application.
This makes the deployment work whether ./data was created by the user, by Docker
(which creates bind-mount dirs as root), or copied from a named volume.
"""
import os
import pwd
import sys


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("entrypoint: no command specified")

    try:
        entry = pwd.getpwnam("syswarden")
    except KeyError:
        # Non-standard image — just exec as-is
        os.execvp(sys.argv[1], sys.argv[1:])
        return

    # Fix bind-mount ownership so the non-root user can write to it
    try:
        os.chown("/app/data", entry.pw_uid, entry.pw_gid)
    except PermissionError:
        pass  # already running as syswarden (local dev without root)

    # Drop to syswarden if we started as root
    if os.getuid() == 0:
        os.setgid(entry.pw_gid)
        os.setuid(entry.pw_uid)

    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
