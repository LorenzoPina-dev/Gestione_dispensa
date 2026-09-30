#!/bin/sh
set -eu

CERT_DIR=/etc/nginx/certs
CERT_FILE="$CERT_DIR/cert.pem"
KEY_FILE="$CERT_DIR/key.pem"

mkdir -p "$CERT_DIR"

if [ ! -s "$CERT_FILE" ] || [ ! -s "$KEY_FILE" ]; then
  echo "[nginx] TLS certificate not found; generating a local self-signed certificate"
  openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days "${TLS_CERT_DAYS:-825}" \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "${TLS_SUBJECT:-/CN=localhost}" \
    -addext "subjectAltName=${TLS_SAN:-DNS:localhost,IP:127.0.0.1}"
  chmod 600 "$KEY_FILE"
  chmod 644 "$CERT_FILE"
fi

nginx -t
exec "$@"
