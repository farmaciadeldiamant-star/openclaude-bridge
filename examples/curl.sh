#!/usr/bin/env bash
# Basic smoke tests against a running openclaude-bridge.
# Usage:  bash curl.sh [host:port]     (default 127.0.0.1:8788)

set -euo pipefail
BASE="${1:-127.0.0.1:8788}"

echo "== GET /health =="
curl -s "http://$BASE/health" | python -m json.tool
echo

echo "== GET /v1/models =="
curl -s "http://$BASE/v1/models" | python -m json.tool
echo

echo "== POST /v1/chat/completions (non-streaming) =="
curl -s "http://$BASE/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-opus-4-6",
    "messages": [{"role":"user","content":"Reply with just: pong"}]
  }' | python -m json.tool
echo

echo "== POST /v1/chat/completions (streaming, SSE) =="
curl -sN "http://$BASE/v1/chat/completions" \
  -H 'content-type: application/json' \
  -d '{
    "model": "claude-opus-4-6",
    "stream": true,
    "messages": [{"role":"user","content":"Count 1 to 3, one per line."}]
  }'
echo
