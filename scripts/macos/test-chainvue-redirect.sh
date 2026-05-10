#!/usr/bin/env bash
set -uo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This test script is macOS-only." >&2
  exit 1
fi

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
VNS_RESOLVER_URL="${VNS_RESOLVER_URL:-http://127.0.0.1:8080}"
VNS_REDIRECT_PORT="${VNS_REDIRECT_PORT:-8081}"
VNS_TEST_HOST="${VNS_TEST_HOST:-chainvue.${VNS_TLD}}"
VNS_EXPECTED_PROXY_TARGET_HOST="${VNS_EXPECTED_PROXY_TARGET_HOST:-chainvue.io}"

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

pass() {
  echo "PASS: $1"
}

fail() {
  echo "FAIL: $1"
  FAILED=1
}

FAILED=0
RESOLVER_OK=0
COREDNS_LISTENING=0
REDIRECT_8081_LISTENING=0
REDIRECT_80_LISTENING=0

echo "Testing ${VNS_TEST_HOST} local PROXY path"
echo

RESOLVER_OUTPUT="$(curl -fsS --max-time 5 "${VNS_RESOLVER_URL}/health" 2>&1)"
if [[ "$?" -eq 0 ]]; then
  RESOLVER_OK=1
  pass "VNS HTTP resolver is reachable at ${VNS_RESOLVER_URL}"
else
  fail "VNS HTTP resolver is not reachable at ${VNS_RESOLVER_URL}"
  echo "${RESOLVER_OUTPUT}"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iUDP:"${VNS_DNS_PORT}" >/dev/null 2>&1; then
  COREDNS_LISTENING=1
  pass "CoreDNS UDP listener is present on port ${VNS_DNS_PORT}"
else
  fail "CoreDNS UDP listener is not present on port ${VNS_DNS_PORT}"
fi

CORE_DNS_OUTPUT="$(dig +time=2 +tries=1 @127.0.0.1 -p "${VNS_DNS_PORT}" "${VNS_TEST_HOST}" A +short 2>&1)"
if printf '%s\n' "${CORE_DNS_OUTPUT}" | awk '$0 == "127.0.0.1" { found=1 } END { exit found ? 0 : 1 }'; then
  pass "direct CoreDNS returned 127.0.0.1"
else
  fail "direct CoreDNS did not return 127.0.0.1"
  echo "${CORE_DNS_OUTPUT}"
fi

DSCACHE_OUTPUT="$(run_with_timeout 8 dscacheutil -q host -a name "${VNS_TEST_HOST}" 2>&1)"
DSCACHE_STATUS=$?
if [[ "${DSCACHE_STATUS}" -eq 0 ]] && printf '%s\n' "${DSCACHE_OUTPUT}" | awk '$1 == "ip_address:" && $2 == "127.0.0.1" { found=1 } END { exit found ? 0 : 1 }'; then
  pass "macOS resolver returned 127.0.0.1"
else
  fail "macOS resolver did not return 127.0.0.1"
  echo "${DSCACHE_OUTPUT}"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${VNS_REDIRECT_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  REDIRECT_8081_LISTENING=1
  pass "redirect service listener is present on port ${VNS_REDIRECT_PORT}"
else
  fail "redirect service listener is not present on port ${VNS_REDIRECT_PORT}"
fi

HOST_HEADER_OUTPUT="$(curl -i --max-time 10 -H "Host: ${VNS_TEST_HOST}" "http://127.0.0.1:${VNS_REDIRECT_PORT}/" 2>&1)"
if printf '%s\n' "${HOST_HEADER_OUTPUT}" | grep -Eiq '^HTTP/[^ ]+ 200 ' &&
  printf '%s\n' "${HOST_HEADER_OUTPUT}" | grep -Eiq '^x-vdns-proxy: 1\r?$' &&
  printf '%s\n' "${HOST_HEADER_OUTPUT}" | grep -Eiq "^x-vdns-proxy-target-host: ${VNS_EXPECTED_PROXY_TARGET_HOST}\r?$"; then
  pass "gateway on port ${VNS_REDIRECT_PORT} proxied ${VNS_TEST_HOST} to ${VNS_EXPECTED_PROXY_TARGET_HOST}"
else
  fail "gateway on port ${VNS_REDIRECT_PORT} did not return expected PROXY response"
  echo "${HOST_HEADER_OUTPUT}"
fi

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:80 -sTCP:LISTEN >/dev/null 2>&1; then
  REDIRECT_80_LISTENING=1
  pass "port 80 listener is present"
else
  fail "port 80 listener is not present"
fi

PORT80_OUTPUT="$(curl -i --max-time 10 "http://${VNS_TEST_HOST}" 2>&1)"
if printf '%s\n' "${PORT80_OUTPUT}" | grep -Eiq '^HTTP/[^ ]+ 200 ' &&
  printf '%s\n' "${PORT80_OUTPUT}" | grep -Eiq '^x-vdns-proxy: 1\r?$' &&
  printf '%s\n' "${PORT80_OUTPUT}" | grep -Eiq "^x-vdns-proxy-target-host: ${VNS_EXPECTED_PROXY_TARGET_HOST}\r?$"; then
  pass "http://${VNS_TEST_HOST} proxied to ${VNS_EXPECTED_PROXY_TARGET_HOST}"
else
  fail "http://${VNS_TEST_HOST} did not return expected PROXY response"
  echo "${PORT80_OUTPUT}"
fi

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "Success: http://${VNS_TEST_HOST} is resolving locally and proxying."
  exit 0
fi

if [[ "${RESOLVER_OK}" -ne 1 ]]; then
  echo "Next step: VNS HTTP resolver is not running or not reachable. Start it on ${VNS_RESOLVER_URL} first."
elif [[ "${COREDNS_LISTENING}" -ne 1 ]]; then
  echo "Next step: CoreDNS is not listening on port ${VNS_DNS_PORT}. Start it with: cd coredns && ./run-local-resolver.sh"
elif ! printf '%s\n' "${CORE_DNS_OUTPUT}" | awk '$0 == "127.0.0.1" { found=1 } END { exit found ? 0 : 1 }'; then
  echo "Next step: CoreDNS is listening but did not return 127.0.0.1. Check the VNS record and resolver response for ${VNS_TEST_HOST}."
elif [[ "${DSCACHE_STATUS}" -ne 0 ]] || ! printf '%s\n' "${DSCACHE_OUTPUT}" | awk '$1 == "ip_address:" && $2 == "127.0.0.1" { found=1 } END { exit found ? 0 : 1 }'; then
  echo "Next step: direct CoreDNS passed but macOS resolver failed. Check /etc/resolver/${VNS_TLD} and macOS DNS state."
elif [[ "${REDIRECT_8081_LISTENING}" -ne 1 ]]; then
  echo "Next step: gateway is not listening on port ${VNS_REDIRECT_PORT}. Start it with: VDNS_PROXY_ENABLED=true VNS_RESOLVER_URL=${VNS_RESOLVER_URL} VNS_REDIRECT_PORT=${VNS_REDIRECT_PORT} pnpm redirect:dev"
elif [[ "${REDIRECT_80_LISTENING}" -ne 1 ]]; then
  echo "Next step: gateway is not listening on port 80. Start it with: pnpm build && VDNS_PROXY_ENABLED=true sudo scripts/macos/start-redirect-port80.sh"
elif printf '%s\n' "${HOST_HEADER_OUTPUT}" | grep -Eiq '^x-vdns-proxy: 1\r?$' &&
  ! printf '%s\n' "${PORT80_OUTPUT}" | grep -Eiq '^x-vdns-proxy: 1\r?$'; then
  echo "Next step: port ${VNS_REDIRECT_PORT} Host-header PROXY works, but http://${VNS_TEST_HOST} does not. Start the gateway on port 80."
  echo "Run: pnpm build && VDNS_PROXY_ENABLED=true sudo scripts/macos/start-redirect-port80.sh"
else
  echo "Next step: run scripts/macos/diagnose-vdns.sh for the full report."
fi

exit 1
