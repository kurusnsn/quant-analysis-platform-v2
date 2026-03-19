#!/usr/bin/env bash
set -euo pipefail

# Generate a self-signed origin certificate for Cloudflare SSL mode = "Full".
# Cloudflare "Full" does not validate the certificate chain, but it does require HTTPS on the origin.
#
# Usage:
#   DOMAIN=quant-platform.com OUT_DIR=/opt/quant-platform/env/nginx/ssl ./infra/scripts/generate-origin-cert.sh

DOMAIN="${DOMAIN:-quant-platform.com}"
OUT_DIR="${OUT_DIR:-/opt/quant-platform/env/nginx/ssl}"

CRT_PATH="$OUT_DIR/origin.crt"
KEY_PATH="$OUT_DIR/origin.key"

mkdir -p "$OUT_DIR"

if [[ -f "$CRT_PATH" || -f "$KEY_PATH" ]]; then
  echo "origin cert/key already exist:"
  echo "  $CRT_PATH"
  echo "  $KEY_PATH"
  exit 0
fi

openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 3650 \
  -keyout "$KEY_PATH" \
  -out "$CRT_PATH" \
  -subj "/CN=$DOMAIN" \
  -addext "subjectAltName=DNS:$DOMAIN,DNS:*.$DOMAIN"

chmod 600 "$KEY_PATH"
chmod 644 "$CRT_PATH"

echo "generated:"
echo "  $CRT_PATH"
echo "  $KEY_PATH"

