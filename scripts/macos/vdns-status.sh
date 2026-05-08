#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
VNS_RESOLVER_URL="$(vdns_resolver_url)"
VNS_REDIRECT_PORT="${VNS_REDIRECT_PORT:-8081}"
RESOLVER_FILE="/etc/resolver/${VNS_TLD}"
PID_DIR="${REPO_ROOT}/.vdns/pids"

echo "vDNS macOS status"
vdns_safe_config

vdns_section "HTTP Resolver"
if vdns_timeout 5 curl -fsS "${VNS_RESOLVER_URL}/debug/config"; then
  echo
else
  echo "Resolver not reachable at ${VNS_RESOLVER_URL}"
fi

vdns_section "CoreDNS Listeners"
if command -v lsof >/dev/null 2>&1; then
  vdns_lsof_port UDP "${VNS_DNS_PORT}"
  vdns_lsof_port TCP "${VNS_DNS_PORT}"
else
  echo "lsof is not available"
fi

vdns_section "macOS Split DNS"
if [[ -f "${RESOLVER_FILE}" ]]; then
  echo "found ${RESOLVER_FILE}"
  sed 's/^/  /' "${RESOLVER_FILE}"
else
  echo "missing ${RESOLVER_FILE}"
fi

echo
echo "scutil section:"
vdns_timeout 5 scutil --dns |
  awk -v domain="${VNS_TLD}" '/domain[[:space:]]+:[[:space:]]+/ && $NF == domain { show=1; count=0 } show { print; count++ } show && count >= 12 { show=0 }'

vdns_section "Redirect Listeners"
if [[ -f "${PID_DIR}/redirect.pid" ]]; then
  REDIRECT_PID="$(tr -d '[:space:]' < "${PID_DIR}/redirect.pid")"
  if vdns_pid_matches "${REDIRECT_PID}" "dist/redirect-index.js"; then
    echo "port 80 redirect PID file: ${REDIRECT_PID} (dist/redirect-index.js)"
  else
    echo "port 80 redirect PID file is stale or unrelated: ${REDIRECT_PID}"
  fi
else
  echo "port 80 redirect PID file: missing"
fi

if command -v lsof >/dev/null 2>&1; then
  echo
  echo "visible TCP listeners:"
  vdns_lsof_port TCP 80
  vdns_lsof_port TCP "${VNS_REDIRECT_PORT}"
else
  echo "lsof is not available"
fi

vdns_section "Resolution Checks"
echo "$ dig @127.0.0.1 -p ${VNS_DNS_PORT} google.${VNS_TLD} A +short"
vdns_timeout 5 dig +time=2 +tries=1 @127.0.0.1 -p "${VNS_DNS_PORT}" "google.${VNS_TLD}" A +short
echo "$ dscacheutil -q host -a name google.${VNS_TLD}"
vdns_timeout 8 dscacheutil -q host -a name "google.${VNS_TLD}"
echo "$ dscacheutil -q host -a name chainvue.${VNS_TLD}"
vdns_timeout 8 dscacheutil -q host -a name "chainvue.${VNS_TLD}"

vdns_section "HTTP Redirect Check"
echo "$ curl -i --max-time 5 http://chainvue.${VNS_TLD}"
vdns_timeout 8 curl -i --max-time 5 "http://chainvue.${VNS_TLD}"
