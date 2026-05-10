#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"

if ! vdns_load_env "${REPO_ROOT}" >/dev/null; then
  echo "Create ${VDNS_ENV_FILE} first. Run: vdns setup" >&2
  exit 1
fi

ENTRYPOINT="${REPO_ROOT}/dist/redirect-index.js"
if [[ ! -f "${ENTRYPOINT}" ]]; then
  echo "Missing built redirect service entrypoint: ${ENTRYPOINT}" >&2
  echo "Run: pnpm build" >&2
  exit 1
fi

if ! NODE_BIN="$(vdns_find_node)"; then
  echo "Could not find node. Set NODE_BIN=/path/to/node in the launchd environment or reinstall services." >&2
  exit 1
fi

export VNS_REDIRECT_HOST=127.0.0.1
export VNS_REDIRECT_PORT=80
export VDNS_PROXY_ENABLED="${VDNS_PROXY_ENABLED:-false}"
export VDNS_PROXY_TIMEOUT_MS="${VDNS_PROXY_TIMEOUT_MS:-10000}"
export VDNS_PROXY_MAX_BODY_BYTES="${VDNS_PROXY_MAX_BODY_BYTES:-10485760}"
export VDNS_PROXY_MAX_REDIRECTS="${VDNS_PROXY_MAX_REDIRECTS:-3}"
export VDNS_PROXY_ALLOW_PRIVATE_TARGETS="${VDNS_PROXY_ALLOW_PRIVATE_TARGETS:-false}"
export VNS_RESOLVER_URL="${VNS_RESOLVER_URL:-http://127.0.0.1:${PORT:-8080}}"

exec "${NODE_BIN}" "${ENTRYPOINT}"
