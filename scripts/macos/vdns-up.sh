#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_require_env "${REPO_ROOT}"

VDNS_TLD="${VDNS_TLD:-vdns}"
VDNS_DNS_PORT="${VDNS_DNS_PORT:-1053}"
VDNS_RESOLVER_URL="$(vdns_resolver_url)"
VDNS_GATEWAY_HOST="${VDNS_GATEWAY_HOST:-127.0.0.1}"
VDNS_GATEWAY_PORT="${VDNS_GATEWAY_PORT:-8081}"

STATE_DIR="${VDNS_STATE_DIR}"
PID_DIR="${VDNS_PID_DIR}"
LOG_DIR="${VDNS_LOG_DIR}"
STARTED_RESOLVER=0
STARTED_COREDNS=0
STARTED_REDIRECT=0

cleanup_started() {
  local status=$?
  if [[ "${status}" -eq 0 ]]; then
    return 0
  fi

  echo
  echo "vdns-up failed; stopping processes started by this invocation."
  if [[ "${STARTED_REDIRECT}" -eq 1 ]]; then
    sudo "${SCRIPT_DIR}/stop-redirect-port80.sh" || true
  fi
  if [[ "${STARTED_COREDNS}" -eq 1 ]]; then
    vdns_stop_pid_file "${PID_DIR}/coredns.pid" "coredns-vdns" "CoreDNS" || true
  fi
  if [[ "${STARTED_RESOLVER}" -eq 1 ]]; then
    vdns_stop_pid_file "${PID_DIR}/resolver.pid" "dist/index.js" "HTTP resolver" || true
  fi
}
trap cleanup_started EXIT

if [[ ! -f "${REPO_ROOT}/dist/index.js" || ! -f "${REPO_ROOT}/dist/redirect-index.js" ]]; then
  echo "Missing built entrypoints under dist/." >&2
  echo "Run: pnpm build" >&2
  exit 1
fi

if [[ ! -x "${REPO_ROOT}/coredns/coredns-vdns" ]]; then
  echo "Missing CoreDNS binary: coredns/coredns-vdns" >&2
  echo "Run: cd coredns && ./build-coredns.sh" >&2
  exit 1
fi

mkdir -p "${PID_DIR}" "${LOG_DIR}"

echo "Starting local vDNS stack"
vdns_safe_config

if curl -fsS --max-time 3 "${VDNS_RESOLVER_URL}/debug/config" >/dev/null 2>&1; then
  echo "HTTP resolver already running at ${VDNS_RESOLVER_URL}"
elif curl -fsS --max-time 3 "http://127.0.0.1:8080/debug/config" >/dev/null 2>&1; then
  VDNS_RESOLVER_URL="http://127.0.0.1:8080"
  echo "HTTP resolver already running at ${VDNS_RESOLVER_URL}"
else
  echo "Starting HTTP resolver on ${VDNS_RESOLVER_URL}"
  node "${REPO_ROOT}/dist/index.js" >"${LOG_DIR}/resolver.log" 2>&1 &
  echo "$!" > "${PID_DIR}/resolver.pid"
  STARTED_RESOLVER=1
  sleep 1
  if ! vdns_timeout 10 sh -c "until curl -fsS --max-time 2 '${VDNS_RESOLVER_URL}/debug/config' >/dev/null; do sleep 1; done"; then
    echo "HTTP resolver did not become ready. See ${LOG_DIR}/resolver.log" >&2
    exit 1
  fi
fi

if vdns_has_listener_matching UDP "${VDNS_DNS_PORT}" "coredns-vdns" &&
  vdns_has_listener_matching TCP "${VDNS_DNS_PORT}" "coredns-vdns"; then
  echo "CoreDNS already listening on TCP/UDP ${VDNS_DNS_PORT}"
else
  echo "Starting CoreDNS local resolver on 127.0.0.1:${VDNS_DNS_PORT}"
  "${REPO_ROOT}/coredns/run-local-resolver.sh" >"${LOG_DIR}/coredns.log" 2>&1 &
  echo "$!" > "${PID_DIR}/coredns.pid"
  STARTED_COREDNS=1
  sleep 1
  if ! vdns_timeout 10 sh -c "until lsof -nP -iUDP:${VDNS_DNS_PORT} >/dev/null 2>&1 && lsof -nP -iTCP:${VDNS_DNS_PORT} -sTCP:LISTEN >/dev/null 2>&1; do sleep 1; done"; then
    echo "CoreDNS did not open TCP/UDP ${VDNS_DNS_PORT}. See ${LOG_DIR}/coredns.log" >&2
    exit 1
  fi
  if ! vdns_has_listener_matching UDP "${VDNS_DNS_PORT}" "coredns-vdns" ||
    ! vdns_has_listener_matching TCP "${VDNS_DNS_PORT}" "coredns-vdns"; then
    echo "A listener exists on ${VDNS_DNS_PORT}, but TCP/UDP are not both coredns-vdns." >&2
    exit 1
  fi
fi

RESOLVER_FILE="/etc/resolver/${VDNS_TLD}"
if [[ -f "${RESOLVER_FILE}" ]] &&
  grep -Eq "^nameserver[[:space:]]+127\\.0\\.0\\.1$" "${RESOLVER_FILE}" &&
  grep -Eq "^port[[:space:]]+${VDNS_DNS_PORT}$" "${RESOLVER_FILE}"; then
  echo "macOS split-DNS resolver already installed at ${RESOLVER_FILE}"
else
  echo "Installing macOS split-DNS resolver for .${VDNS_TLD}; sudo may prompt."
  sudo VDNS_TLD="${VDNS_TLD}" VDNS_DNS_PORT="${VDNS_DNS_PORT}" "${SCRIPT_DIR}/install-vdns-resolver.sh"
fi

if vdns_has_listener_matching TCP 80 "dist/redirect-index.js"; then
  echo "Port 80 redirect service already running"
else
  echo "Starting redirect service on 127.0.0.1:80; sudo may prompt."
  sudo VDNS_HOME="${VDNS_HOME}" \
    VDNS_STATE_DIR="${VDNS_STATE_DIR}" \
    VDNS_ENV_FILE="${VDNS_ENV_FILE}" \
    VDNS_LOG_DIR="${VDNS_LOG_DIR}" \
    VDNS_PID_DIR="${VDNS_PID_DIR}" \
    VDNS_BACKGROUND=1 \
    VDNS_PID_FILE="${PID_DIR}/redirect.pid" \
    VDNS_LOG_FILE="${LOG_DIR}/redirect-port80.log" \
    VDNS_RESOLVER_URL="${VDNS_RESOLVER_URL}" \
    VDNS_GATEWAY_HOST="${VDNS_GATEWAY_HOST}" \
    VDNS_GATEWAY_PORT=80 \
    VDNS_PROXY_ENABLED="${VDNS_PROXY_ENABLED:-false}" \
    VDNS_PROXY_TIMEOUT_MS="${VDNS_PROXY_TIMEOUT_MS:-10000}" \
    VDNS_PROXY_MAX_BODY_BYTES="${VDNS_PROXY_MAX_BODY_BYTES:-10485760}" \
    VDNS_PROXY_MAX_REDIRECTS="${VDNS_PROXY_MAX_REDIRECTS:-3}" \
    VDNS_PROXY_ALLOW_PRIVATE_TARGETS="${VDNS_PROXY_ALLOW_PRIVATE_TARGETS:-false}" \
    "${SCRIPT_DIR}/start-redirect-port80.sh"
  STARTED_REDIRECT=1
  REDIRECT_PID="$(tr -d '[:space:]' < "${PID_DIR}/redirect.pid" 2>/dev/null || true)"
  if ! vdns_pid_matches "${REDIRECT_PID}" "dist/redirect-index.js"; then
    echo "Redirect service started, but PID ${REDIRECT_PID:-unknown} does not match dist/redirect-index.js." >&2
    exit 1
  fi
fi

echo
echo "vDNS is up."
echo "Resolver API: ${VDNS_RESOLVER_URL}"
echo "CoreDNS: 127.0.0.1:${VDNS_DNS_PORT}"
echo "macOS resolver: ${RESOLVER_FILE}"
echo "HTTP gateway: http://*.${VDNS_TLD} via 127.0.0.1:80"
echo
echo "Try:"
echo "  vdns status"
echo "  vdns demo"
echo "  dscacheutil -q host -a name google.${VDNS_TLD}"
echo "  curl -i --max-time 10 http://demo-redirect.${VDNS_TLD}"
