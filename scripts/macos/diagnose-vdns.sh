#!/usr/bin/env bash
set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This diagnostic script is macOS-only." >&2
  exit 1
fi

VDNS_TLD="${VDNS_TLD:-vdns}"
VDNS_DNS_PORT="${VDNS_DNS_PORT:-1053}"
VDNS_RESOLVER_URL="${VDNS_RESOLVER_URL:-http://127.0.0.1:8080}"
VDNS_GATEWAY_PORT="${VDNS_GATEWAY_PORT:-8081}"
VDNS_GATEWAY_PORT80="${VDNS_GATEWAY_PORT80:-80}"
VDNS_TEST_HOST="${VDNS_TEST_HOST:-chainvue.${VDNS_TLD}}"
RESOLVER_FILE="/etc/resolver/${VDNS_TLD}"

case "${VDNS_TLD}" in
  ""|*/*)
    echo "VDNS_TLD must be a non-empty resolver name without slashes." >&2
    exit 1
    ;;
esac

if [[ ! "${VDNS_TLD}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "VDNS_TLD must be a lowercase DNS label without a leading dot." >&2
  exit 1
fi

case "${VDNS_DNS_PORT}:${VDNS_GATEWAY_PORT}:${VDNS_GATEWAY_PORT80}" in
  *[!0-9:]*)
    echo "VDNS_DNS_PORT, VDNS_GATEWAY_PORT, and VDNS_GATEWAY_PORT80 must be numeric ports." >&2
    exit 1
    ;;
esac

section() {
  echo
  echo "== $1 =="
}

run_with_timeout() {
  local seconds="$1"
  shift

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${seconds}" "$@"
    return $?
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}" "$@"
    return $?
  fi

  "$@" &
  local command_pid=$!
  (
    sleep "${seconds}"
    kill -TERM "${command_pid}" 2>/dev/null
    sleep 1
    kill -KILL "${command_pid}" 2>/dev/null
  ) &
  local watchdog_pid=$!

  wait "${command_pid}" 2>/dev/null
  local status=$?
  kill "${watchdog_pid}" 2>/dev/null
  wait "${watchdog_pid}" 2>/dev/null
  return "${status}"
}

run_report() {
  local seconds="$1"
  shift
  echo "$ $*"
  run_with_timeout "${seconds}" "$@"
  local status=$?
  if [[ "${status}" -ne 0 ]]; then
    echo "command exited with status ${status}"
  fi
}

echo "vDNS macOS diagnostic report"
echo "domain: ${VDNS_TLD}"
echo "test host: ${VDNS_TEST_HOST}"
echo "CoreDNS expected at 127.0.0.1:${VDNS_DNS_PORT}"
echo "vDNS HTTP resolver expected at ${VDNS_RESOLVER_URL}"
echo "redirect service expected at 127.0.0.1:${VDNS_GATEWAY_PORT} and optionally 127.0.0.1:${VDNS_GATEWAY_PORT80}"

section "Resolver File"
if [[ -f "${RESOLVER_FILE}" ]]; then
  echo "found: ${RESOLVER_FILE}"
  sed 's/^/  /' "${RESOLVER_FILE}"
else
  echo "missing: ${RESOLVER_FILE}"
fi

section "scutil DNS"
echo "$ scutil --dns | awk -v domain=${VDNS_TLD} ..."
run_with_timeout 5 scutil --dns |
  awk -v domain="${VDNS_TLD}" '/domain[[:space:]]+:[[:space:]]+/ && $NF == domain { show=1; count=0 } show { print; count++ } show && count >= 12 { show=0 }'
SCUTIL_STATUS=${PIPESTATUS[0]}
if [[ "${SCUTIL_STATUS}" -ne 0 ]]; then
  echo "command exited with status ${SCUTIL_STATUS}"
fi

section "CoreDNS Listeners"
if command -v lsof >/dev/null 2>&1; then
  run_report 5 lsof -nP -iUDP:"${VDNS_DNS_PORT}"
  run_report 5 lsof -nP -iTCP:"${VDNS_DNS_PORT}" -sTCP:LISTEN
else
  echo "lsof is not available; skipping listener checks."
fi

section "vDNS HTTP Resolver"
run_report 5 curl -i --max-time 5 "${VDNS_RESOLVER_URL}/health"
run_report 5 curl -i --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${VDNS_TEST_HOST}?type=A"
run_report 5 curl -i --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${VDNS_TEST_HOST}?type=REDIRECT"

section "Redirect Listeners"
if command -v lsof >/dev/null 2>&1; then
  run_report 5 lsof -nP -iTCP:"${VDNS_GATEWAY_PORT80}" -sTCP:LISTEN
  run_report 5 lsof -nP -iTCP:"${VDNS_GATEWAY_PORT}" -sTCP:LISTEN
else
  echo "lsof is not available; skipping listener checks."
fi

section "Direct CoreDNS Query"
run_report 5 dig +time=2 +tries=1 @127.0.0.1 -p "${VDNS_DNS_PORT}" "${VDNS_TEST_HOST}" A +short

section "macOS Resolver Query"
run_report 8 dscacheutil -q host -a name "${VDNS_TEST_HOST}"

section "dns-sd Query"
run_report 8 dns-sd -G v4 "${VDNS_TEST_HOST}"

section "Direct Redirect Host-Header Test"
run_report 5 curl -i --max-time 5 -H "Host: ${VDNS_TEST_HOST}" "http://127.0.0.1:${VDNS_GATEWAY_PORT}/"

section "HTTP Port 80 Test"
run_report 5 curl -i --max-time 5 "http://${VDNS_TEST_HOST}"
