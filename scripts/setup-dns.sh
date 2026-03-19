#!/usr/bin/env bash
set -euo pipefail

# Thin wrapper around the Python implementation.
# Reads config from repo-root .env (DOMAIN, CLOUDFLARE_ZONE_ID, auth vars).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SCRIPT_DIR/setup-dns.py" "$@"

