#!/usr/bin/env bash
set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This diagnostic script is macOS-only." >&2
  exit 1
fi

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
VNS_RESOLVER_URL="${VNS_RESOLVER_URL:-http://127.0.0.1:8080}"
VNS_REDIRECT_PORT="${VNS_REDIRECT_PORT:-8081}"
VNS_REDIRECT_PORT80="${VNS_REDIRECT_PORT80:-80}"
VNS_TEST_HOST="${VNS_TEST_HOST:-chainvue.${VNS_TLD}}"
RESOLVER_FILE="/etc/resolver/${VNS_TLD}"

case "${VNS_TLD}" in
  ""|*/*)
    echo "VNS_TLD must be a non-empty resolver name without slashes." >&2
    exit 1
    ;;
esac

if [[ ! "${VNS_TLD}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "VNS_TLD must be a lowercase DNS label without a leading dot." >&2
  exit 1
fi

case "${VNS_DNS_PORT}:${VNS_REDIRECT_PORT}:${VNS_REDIRECT_PORT80}" in
  *[!0-9:]*)
    echo "VNS_DNS_PORT, VNS_REDIRECT_PORT, and VNS_REDIRECT_PORT80 must be numeric ports." >&2
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

echo "VNS/vDNS macOS diagnostic report"
echo "domain: ${VNS_TLD}"
echo "test host: ${VNS_TEST_HOST}"
echo "CoreDNS expected at 127.0.0.1:${VNS_DNS_PORT}"
echo "VNS HTTP resolver expected at ${VNS_RESOLVER_URL}"
echo "redirect service expected at 127.0.0.1:${VNS_REDIRECT_PORT} and optionally 127.0.0.1:${VNS_REDIRECT_PORT80}"

section "Resolver File"
if [[ -f "${RESOLVER_FILE}" ]]; then
  echo "found: ${RESOLVER_FILE}"
  sed 's/^/  /' "${RESOLVER_FILE}"
else
  echo "missing: ${RESOLVER_FILE}"
fi

section "scutil DNS"
echo "$ scutil --dns | awk -v domain=${VNS_TLD} ..."
run_with_timeout 5 scutil --dns |
  awk -v domain="${VNS_TLD}" '/domain[[:space:]]+:[[:space:]]+/ && $NF == domain { show=1; count=0 } show { print; count++ } show && count >= 12 { show=0 }'
SCUTIL_STATUS=${PIPESTATUS[0]}
if [[ "${SCUTIL_STATUS}" -ne 0 ]]; then
  echo "command exited with status ${SCUTIL_STATUS}"
fi

section "CoreDNS Listeners"
if command -v lsof >/dev/null 2>&1; then
  run_report 5 lsof -nP -iUDP:"${VNS_DNS_PORT}"
  run_report 5 lsof -nP -iTCP:"${VNS_DNS_PORT}" -sTCP:LISTEN
else
  echo "lsof is not available; skipping listener checks."
fi

section "VNS HTTP Resolver"
run_report 5 curl -i --max-time 5 "${VNS_RESOLVER_URL}/health"
run_report 5 curl -i --max-time 5 "${VNS_RESOLVER_URL}/resolve-domain/${VNS_TEST_HOST}?type=A"
run_report 5 curl -i --max-time 5 "${VNS_RESOLVER_URL}/resolve-domain/${VNS_TEST_HOST}?type=REDIRECT"

section "Redirect Listeners"
if command -v lsof >/dev/null 2>&1; then
  run_report 5 lsof -nP -iTCP:"${VNS_REDIRECT_PORT80}" -sTCP:LISTEN
  run_report 5 lsof -nP -iTCP:"${VNS_REDIRECT_PORT}" -sTCP:LISTEN
else
  echo "lsof is not available; skipping listener checks."
fi

section "Direct CoreDNS Query"
run_report 5 dig +time=2 +tries=1 @127.0.0.1 -p "${VNS_DNS_PORT}" "${VNS_TEST_HOST}" A +short

section "macOS Resolver Query"
run_report 8 dscacheutil -q host -a name "${VNS_TEST_HOST}"

section "dns-sd Query"
run_report 8 dns-sd -G v4 "${VNS_TEST_HOST}"

section "Direct Redirect Host-Header Test"
run_report 5 curl -i --max-time 5 -H "Host: ${VNS_TEST_HOST}" "http://127.0.0.1:${VNS_REDIRECT_PORT}/"

section "HTTP Port 80 Test"
run_report 5 curl -i --max-time 5 "http://${VNS_TEST_HOST}"
