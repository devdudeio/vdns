#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper is macOS-only." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
REPO_ROOT="$(vdns_repo_root)"
ENTRYPOINT="${REPO_ROOT}/dist/redirect-index.js"
RESOLVER_URL="${VNS_RESOLVER_URL:-http://127.0.0.1:8080}"
NODE_BIN="${NODE_BIN:-}"
BACKGROUND="${VNS_BACKGROUND:-0}"
PID_FILE="${VNS_PID_FILE:-}"
LOG_FILE="${VNS_LOG_FILE:-}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Port 80 requires administrator privileges." >&2
  echo "Run: sudo $0" >&2
  exit 1
fi

if [[ ! -f "${ENTRYPOINT}" ]]; then
  echo "Missing built redirect service entrypoint: ${ENTRYPOINT}" >&2
  echo "Run pnpm build first, then rerun this helper with sudo." >&2
  exit 1
fi

if [[ -z "${NODE_BIN}" ]]; then
  if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
  elif [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
  elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN="/usr/local/bin/node"
  else
    echo "Could not find node in root's PATH. Set NODE_BIN=/path/to/node and rerun." >&2
    exit 1
  fi
fi

echo "Checking vDNS HTTP resolver at ${RESOLVER_URL}/health"
if ! curl -fsS --max-time 5 "${RESOLVER_URL}/health" >/dev/null; then
  echo "vDNS HTTP resolver is not reachable at ${RESOLVER_URL}" >&2
  echo "Start the resolver first, or set VNS_RESOLVER_URL before running this helper." >&2
  exit 1
fi

echo "Starting vDNS gateway on 127.0.0.1:80"
echo "This runs the built JS entrypoint directly to avoid root-owned pnpm/node_modules cache files."
echo "Stop it with: sudo ${SCRIPT_DIR}/stop-redirect-port80.sh"
echo

cd "${REPO_ROOT}"
if [[ "${BACKGROUND}" == "1" ]]; then
  if [[ -z "${PID_FILE}" || -z "${LOG_FILE}" ]]; then
    echo "VNS_PID_FILE and VNS_LOG_FILE are required when VNS_BACKGROUND=1." >&2
    exit 1
  fi

  mkdir -p "$(dirname "${PID_FILE}")" "$(dirname "${LOG_FILE}")"
  VDNS_HOME="${VDNS_HOME}" \
  VDNS_STATE_DIR="${VDNS_STATE_DIR}" \
  VDNS_ENV_FILE="${VDNS_ENV_FILE}" \
  VDNS_LOG_DIR="${VDNS_LOG_DIR}" \
  VDNS_PID_DIR="${VDNS_PID_DIR}" \
  VNS_REDIRECT_HOST="${VNS_REDIRECT_HOST:-127.0.0.1}" \
  VNS_REDIRECT_PORT=80 \
  VNS_RESOLVER_URL="${RESOLVER_URL}" \
  VDNS_PROXY_ENABLED="${VDNS_PROXY_ENABLED:-false}" \
  VDNS_PROXY_TIMEOUT_MS="${VDNS_PROXY_TIMEOUT_MS:-10000}" \
  VDNS_PROXY_MAX_BODY_BYTES="${VDNS_PROXY_MAX_BODY_BYTES:-10485760}" \
  VDNS_PROXY_MAX_REDIRECTS="${VDNS_PROXY_MAX_REDIRECTS:-3}" \
  VDNS_PROXY_ALLOW_PRIVATE_TARGETS="${VDNS_PROXY_ALLOW_PRIVATE_TARGETS:-false}" \
  "${NODE_BIN}" "${ENTRYPOINT}" >"${LOG_FILE}" 2>&1 &
  echo "$!" > "${PID_FILE}"
  sleep 1

  if ! kill -0 "$(cat "${PID_FILE}")" 2>/dev/null; then
    echo "Redirect service failed to stay running. See ${LOG_FILE}" >&2
    exit 1
  fi

  echo "Started vDNS gateway in background."
  echo "PID file: ${PID_FILE}"
  echo "Log file: ${LOG_FILE}"
  exit 0
fi

VDNS_HOME="${VDNS_HOME}" \
VDNS_STATE_DIR="${VDNS_STATE_DIR}" \
VDNS_ENV_FILE="${VDNS_ENV_FILE}" \
VDNS_LOG_DIR="${VDNS_LOG_DIR}" \
VDNS_PID_DIR="${VDNS_PID_DIR}" \
VNS_REDIRECT_HOST="${VNS_REDIRECT_HOST:-127.0.0.1}" \
VNS_REDIRECT_PORT=80 \
VNS_RESOLVER_URL="${RESOLVER_URL}" \
VDNS_PROXY_ENABLED="${VDNS_PROXY_ENABLED:-false}" \
VDNS_PROXY_TIMEOUT_MS="${VDNS_PROXY_TIMEOUT_MS:-10000}" \
VDNS_PROXY_MAX_BODY_BYTES="${VDNS_PROXY_MAX_BODY_BYTES:-10485760}" \
VDNS_PROXY_MAX_REDIRECTS="${VDNS_PROXY_MAX_REDIRECTS:-3}" \
VDNS_PROXY_ALLOW_PRIVATE_TARGETS="${VDNS_PROXY_ALLOW_PRIVATE_TARGETS:-false}" \
"${NODE_BIN}" "${ENTRYPOINT}"
