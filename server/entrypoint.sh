#!/bin/sh
set -eu

if [ -n "${DATABASE_TUNNEL_HOSTNAME:-}" ]; then
  : "${TUNNEL_SERVICE_TOKEN_ID:?DATABASE_TUNNEL_HOSTNAME requires TUNNEL_SERVICE_TOKEN_ID}" "${TUNNEL_SERVICE_TOKEN_SECRET:?DATABASE_TUNNEL_HOSTNAME requires TUNNEL_SERVICE_TOKEN_SECRET}"
  (
    while :; do
      cloudflared access tcp --hostname "$DATABASE_TUNNEL_HOSTNAME" --url 127.0.0.1:5432 --loglevel warn || true
      sleep 1
    done
  ) &
  unset TUNNEL_SERVICE_TOKEN_ID TUNNEL_SERVICE_TOKEN_SECRET
  attempts=0
  until node -e 'require("node:net").connect(5432, "127.0.0.1").on("connect", () => process.exit(0)).on("error", () => process.exit(1))'; do
    attempts=$((attempts + 1))
    [ "$attempts" -lt 40 ] || { echo "The database tunnel did not open 127.0.0.1:5432" >&2; exit 1; }
    sleep 0.25
  done
fi

exec "$@"
