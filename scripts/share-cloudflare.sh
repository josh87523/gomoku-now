#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3100}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-/tmp/cloudflared}"
TUNNEL_LOG="${ROOT_DIR}/.cloudflared-share.log"
SERVER_LOG="${ROOT_DIR}/.share-server.log"

find_free_port() {
  python3 - <<'PY'
import socket

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
}

start_server() {
  (
    cd "$ROOT_DIR"
    exec env PORT="$PORT" PUBLIC_BASE_URL="$1" node server.js >"$SERVER_LOG" 2>&1
  ) &
  SERVER_PID=$!
}

wait_for_http() {
  local url="$1"
  for _ in $(seq 1 40); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

wait_for_port_free() {
  local port="$1"
  for _ in $(seq 1 40); do
    if ! lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  PORT="$(find_free_port)"
fi

if [ ! -x "$CLOUDFLARED_BIN" ]; then
  curl -L "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz" -o /tmp/cloudflared.tgz
  tar -xzf /tmp/cloudflared.tgz -C /tmp
  chmod +x "$CLOUDFLARED_BIN"
fi

rm -f "$TUNNEL_LOG" "$SERVER_LOG"

start_server "http://127.0.0.1:${PORT}"

cleanup() {
  kill "$SERVER_PID" >/dev/null 2>&1 || true
  if [ -n "${TUNNEL_PID:-}" ]; then
    kill "$TUNNEL_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

wait_for_http "http://127.0.0.1:${PORT}/app-config.js" || {
  echo "local server did not become ready"
  cat "$SERVER_LOG"
  exit 1
}

"$CLOUDFLARED_BIN" tunnel --protocol http2 --url "http://127.0.0.1:${PORT}" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

URL=""
for _ in $(seq 1 30); do
  if grep -q "https://.*trycloudflare.com" "$TUNNEL_LOG"; then
    URL="$(grep -Eo 'https://[a-z0-9.-]+trycloudflare.com' "$TUNNEL_LOG" | head -1)"
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "cloudflare tunnel url not found"
  cat "$TUNNEL_LOG"
  exit 1
fi

kill "$SERVER_PID" >/dev/null 2>&1 || true
wait "$SERVER_PID" 2>/dev/null || true
wait_for_port_free "$PORT" || {
  echo "port $PORT did not free up after restarting server"
  cat "$SERVER_LOG"
  exit 1
}

start_server "$URL"

wait_for_http "http://127.0.0.1:${PORT}/app-config.js" || {
  echo "public-base server did not become ready"
  cat "$SERVER_LOG"
  exit 1
}

if ! grep -q "$URL" <(curl -fsS "http://127.0.0.1:${PORT}/app-config.js"); then
  echo "server app-config did not pick up the public url"
  curl -fsS "http://127.0.0.1:${PORT}/app-config.js"
  exit 1
fi

echo "$URL"
echo "server log: $SERVER_LOG"
echo "tunnel log: $TUNNEL_LOG"
wait "$TUNNEL_PID"
