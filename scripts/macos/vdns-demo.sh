#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true

VDNS_TLD="${VDNS_TLD:-vdns}"
VDNS_DNS_PORT="${VDNS_DNS_PORT:-1053}"
VDNS_RESOLVER_URL="$(vdns_resolver_url)"
GOOGLE_HOST="${VDNS_DEMO_GOOGLE_HOST:-google.${VDNS_TLD}}"
GOOGLE_EXPECTED_A="${VDNS_DEMO_GOOGLE_A:-142.250.181.238}"
REDIRECT_HOST="${VDNS_DEMO_REDIRECT_HOST:-demo-redirect.${VDNS_TLD}}"
REDIRECT_EXPECTED_A="${VDNS_DEMO_REDIRECT_A:-127.0.0.1}"
REDIRECT_EXPECTED_LOCATION="${VDNS_DEMO_REDIRECT_LOCATION:-https://verus.io/}"
PROXY_HOST="${VDNS_DEMO_PROXY_HOST:-demo-proxy.${VDNS_TLD}}"
PROXY_EXPECTED_TARGET_HOST="${VDNS_DEMO_PROXY_TARGET_HOST:-verus.io}"
VDNS_HTTPS_ENABLED="${VDNS_HTTPS_ENABLED:-false}"
FAILED=0

if [[ -t 1 && -z "${NO_COLOR:-}" ]]; then
  BOLD="$(printf '\033[1m')"
  DIM="$(printf '\033[2m')"
  GREEN="$(printf '\033[32m')"
  RED="$(printf '\033[31m')"
  YELLOW="$(printf '\033[33m')"
  RESET="$(printf '\033[0m')"
else
  BOLD=""
  DIM=""
  GREEN=""
  RED=""
  YELLOW=""
  RESET=""
fi

section() {
  echo
  echo "${BOLD}$1${RESET}"
}

pass() {
  echo "${GREEN}PASS${RESET} $1"
}

fail() {
  echo "${RED}FAIL${RESET} $1"
  FAILED=1
}

warn() {
  echo "${YELLOW}WARN${RESET} $1"
}

show_cmd() {
  echo "${DIM}$ $*${RESET}"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "missing required command: $1"
  fi
}

run_capture() {
  local seconds="$1"
  shift
  vdns_timeout "${seconds}" "$@" 2>&1
}

expect_contains_line() {
  local output="$1"
  local expected="$2"

  printf '%s\n' "${output}" | awk -v expected="${expected}" '$0 == expected { found=1 } END { exit found ? 0 : 1 }'
}

expect_dscache_ip() {
  local output="$1"
  local expected="$2"

  printf '%s\n' "${output}" | awk -v expected="${expected}" '$1 == "ip_address:" && $2 == expected { found=1 } END { exit found ? 0 : 1 }'
}

expect_http_redirect() {
  local output="$1"
  local location="$2"

  printf '%s\n' "${output}" | grep -Eiq '^HTTP/[^ ]+ 302 ' &&
    printf '%s\n' "${output}" | grep -Eiq "^location: ${location//\//\\/}"'\r?$'
}

expect_proxy_response() {
  local output="$1"
  local target_host="$2"

  printf '%s\n' "${output}" | grep -Eiq '^HTTP/[^ ]+ 200 ' &&
    printf '%s\n' "${output}" | grep -Eiq '^x-vdns-proxy: 1\r?$' &&
    printf '%s\n' "${output}" | grep -Eiq "^x-vdns-proxy-target-host: ${target_host}\r?$"
}

run_show() {
  echo
  show_cmd "$@"
  vdns_timeout 10 "$@"
}

echo "${BOLD}vDNS Terminal Demo${RESET}"
echo "VerusID records -> HTTP resolver -> CoreDNS -> macOS split-DNS -> local HTTP gateway"
echo
echo "Demo hosts:"
echo "  ${GOOGLE_HOST} -> ${GOOGLE_EXPECTED_A}"
echo "  ${REDIRECT_HOST} -> ${REDIRECT_EXPECTED_A} -> ${REDIRECT_EXPECTED_LOCATION}"
echo "  ${PROXY_HOST} -> PROXY ${PROXY_EXPECTED_TARGET_HOST}"

require_command curl
require_command dig
require_command dscacheutil

if [[ "${FAILED}" -ne 0 ]]; then
  echo
  echo "Install missing commands, then rerun: vdns demo"
  exit 1
fi

section "1. HTTP resolver"
show_cmd curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/debug/config"
CONFIG_OUTPUT="$(run_capture 7 curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/debug/config")"
CONFIG_STATUS=$?
printf '%s\n' "${CONFIG_OUTPUT}"
if [[ "${CONFIG_STATUS}" -eq 0 ]] &&
  printf '%s\n' "${CONFIG_OUTPUT}" | grep -q '"mode":"rpc"' &&
  printf '%s\n' "${CONFIG_OUTPUT}" | grep -q "\"tld\":\"${VDNS_TLD}\""; then
  pass "resolver is reachable at ${VDNS_RESOLVER_URL}"
else
  fail "resolver is not ready at ${VDNS_RESOLVER_URL}"
fi

section "2. VerusID-backed records"
show_cmd curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${GOOGLE_HOST}?type=A"
GOOGLE_JSON="$(run_capture 7 curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${GOOGLE_HOST}?type=A")"
GOOGLE_JSON_STATUS=$?
printf '%s\n' "${GOOGLE_JSON}"
if [[ "${GOOGLE_JSON_STATUS}" -eq 0 ]] && printf '%s\n' "${GOOGLE_JSON}" | grep -q "\"value\":\"${GOOGLE_EXPECTED_A}\""; then
  pass "${GOOGLE_HOST} has A ${GOOGLE_EXPECTED_A}"
else
  fail "${GOOGLE_HOST} did not return expected A record"
fi

echo
show_cmd curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${REDIRECT_HOST}?type=REDIRECT"
REDIRECT_JSON="$(run_capture 7 curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${REDIRECT_HOST}?type=REDIRECT")"
REDIRECT_JSON_STATUS=$?
printf '%s\n' "${REDIRECT_JSON}"
if [[ "${REDIRECT_JSON_STATUS}" -eq 0 ]] && printf '%s\n' "${REDIRECT_JSON}" | grep -q "\"url\":\"${REDIRECT_EXPECTED_LOCATION}\""; then
  pass "${REDIRECT_HOST} has REDIRECT ${REDIRECT_EXPECTED_LOCATION}"
else
  fail "${REDIRECT_HOST} did not return expected REDIRECT record"
fi

echo
show_cmd curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${PROXY_HOST}?type=PROXY"
PROXY_JSON="$(run_capture 7 curl -fsS --max-time 5 "${VDNS_RESOLVER_URL}/resolve-domain/${PROXY_HOST}?type=PROXY")"
PROXY_JSON_STATUS=$?
printf '%s\n' "${PROXY_JSON}"
if [[ "${PROXY_JSON_STATUS}" -eq 0 ]] && printf '%s\n' "${PROXY_JSON}" | grep -q "\"url\":\"https://${PROXY_EXPECTED_TARGET_HOST}/\""; then
  pass "${PROXY_HOST} has PROXY https://${PROXY_EXPECTED_TARGET_HOST}/"
else
  fail "${PROXY_HOST} did not return expected PROXY record"
fi

section "3. CoreDNS direct lookup"
show_cmd dig +time=2 +tries=1 @127.0.0.1 -p "${VDNS_DNS_PORT}" "${GOOGLE_HOST}" A +short
CORE_DNS_OUTPUT="$(run_capture 5 dig +time=2 +tries=1 @127.0.0.1 -p "${VDNS_DNS_PORT}" "${GOOGLE_HOST}" A +short)"
CORE_DNS_STATUS=$?
printf '%s\n' "${CORE_DNS_OUTPUT}"
if [[ "${CORE_DNS_STATUS}" -eq 0 ]] && expect_contains_line "${CORE_DNS_OUTPUT}" "${GOOGLE_EXPECTED_A}"; then
  pass "CoreDNS returned ${GOOGLE_EXPECTED_A}"
else
  fail "CoreDNS did not return ${GOOGLE_EXPECTED_A}"
fi

section "4. macOS split-DNS"
show_cmd dscacheutil -q host -a name "${GOOGLE_HOST}"
GOOGLE_DSCACHE="$(run_capture 10 dscacheutil -q host -a name "${GOOGLE_HOST}")"
GOOGLE_DSCACHE_STATUS=$?
printf '%s\n' "${GOOGLE_DSCACHE}"
if [[ "${GOOGLE_DSCACHE_STATUS}" -eq 0 ]] && expect_dscache_ip "${GOOGLE_DSCACHE}" "${GOOGLE_EXPECTED_A}"; then
  pass "macOS resolver returned ${GOOGLE_EXPECTED_A}"
else
  fail "macOS resolver did not return ${GOOGLE_EXPECTED_A}"
fi

echo
show_cmd dscacheutil -q host -a name "${REDIRECT_HOST}"
REDIRECT_DSCACHE="$(run_capture 10 dscacheutil -q host -a name "${REDIRECT_HOST}")"
REDIRECT_DSCACHE_STATUS=$?
printf '%s\n' "${REDIRECT_DSCACHE}"
if [[ "${REDIRECT_DSCACHE_STATUS}" -eq 0 ]] && expect_dscache_ip "${REDIRECT_DSCACHE}" "${REDIRECT_EXPECTED_A}"; then
  pass "macOS resolver returned ${REDIRECT_EXPECTED_A}"
else
  fail "macOS resolver did not return ${REDIRECT_EXPECTED_A}"
fi

section "5. Browser-style HTTP gateway"
show_cmd curl -i --max-time 10 "http://${PROXY_HOST}"
PROXY_HTTP_OUTPUT="$(run_capture 12 curl -i --max-time 10 "http://${PROXY_HOST}")"
PROXY_HTTP_STATUS=$?
printf '%s\n' "${PROXY_HTTP_OUTPUT}"

echo
if [[ "${PROXY_HTTP_STATUS}" -eq 0 ]] && expect_proxy_response "${PROXY_HTTP_OUTPUT}" "${PROXY_EXPECTED_TARGET_HOST}"; then
  pass "${PROXY_HOST} returned proxied ${PROXY_EXPECTED_TARGET_HOST} content"
else
  fail "${PROXY_HOST} did not return the expected PROXY response"
fi

section "6. Browser-style HTTPS gateway"
if [[ "${VDNS_HTTPS_ENABLED}" == "true" ]]; then
  show_cmd curl -I --max-time 20 "https://${PROXY_HOST}"
  PROXY_HTTPS_OUTPUT="$(run_capture 22 curl -I --max-time 20 "https://${PROXY_HOST}")"
  PROXY_HTTPS_STATUS=$?
  printf '%s\n' "${PROXY_HTTPS_OUTPUT}"
  if [[ "${PROXY_HTTPS_STATUS}" -eq 0 ]] && expect_proxy_response "${PROXY_HTTPS_OUTPUT}" "${PROXY_EXPECTED_TARGET_HOST}"; then
    pass "${PROXY_HOST} returned trusted HTTPS proxied ${PROXY_EXPECTED_TARGET_HOST} headers"
  else
    fail "${PROXY_HOST} did not return the expected trusted HTTPS PROXY response"
  fi
else
  warn "HTTPS is disabled; skipping https://${PROXY_HOST}"
fi

section "Result"
if [[ "${FAILED}" -eq 0 ]]; then
  echo "${GREEN}${BOLD}vDNS demo passed.${RESET}"
  echo "Stop the local stack with: vdns stop"
  exit 0
fi

echo "${RED}${BOLD}vDNS demo failed.${RESET}"
echo
echo "Fast recovery checklist:"
if [[ "${CONFIG_STATUS:-1}" -ne 0 ]]; then
  echo "  1. Start the stack: vdns start"
elif [[ "${CORE_DNS_STATUS:-1}" -ne 0 ]]; then
  echo "  1. Check CoreDNS logs: tail -n 80 .vdns/logs/coredns.log"
elif [[ "${GOOGLE_DSCACHE_STATUS:-1}" -ne 0 || "${REDIRECT_DSCACHE_STATUS:-1}" -ne 0 ]]; then
  echo "  1. Check split-DNS: vdns status"
elif [[ "${PROXY_HTTP_STATUS:-1}" -ne 0 ]]; then
  echo "  1. Check redirect logs: tail -n 80 .vdns/logs/redirect-port80.log"
else
  echo "  1. Inspect status: vdns status"
fi
echo "  2. Run diagnostics: scripts/macos/diagnose-vdns.sh"
echo "  3. Rerun this demo: vdns demo"
exit 1
