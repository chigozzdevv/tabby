#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$ROOT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$ROOT_DIR/.env"
  set +a
fi

: "${RPC_URL:?RPC_URL is required}"
: "${PRIVATE_KEY:?PRIVATE_KEY is required}"
: "${TABBY_SIGNER:?TABBY_SIGNER is required}"

forge script script/DeployTabby.s.sol:DeployTabby \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --sig "run()"
