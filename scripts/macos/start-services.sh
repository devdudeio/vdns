#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-services-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_require_launchd_accessible_repo "${REPO_ROOT}"

if [[ ! -f "${VDNS_ENV_FILE}" ]]; then
  echo "Create ${VDNS_ENV_FILE} first. Run: vdns setup" >&2
  exit 1
fi

vdns_load_env "${REPO_ROOT}" >/dev/null
PORT="${PORT:-8080}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"

vdns_require_file "$(vdns_resolver_plist)" "Missing LaunchAgent: $(vdns_resolver_plist). Run: vdns install"
vdns_require_file "$(vdns_coredns_plist)" "Missing LaunchAgent: $(vdns_coredns_plist). Run: vdns install"
if [[ ! -f "$(vdns_redirect_plist)" ]]; then
  echo "Missing LaunchDaemon: $(vdns_redirect_plist). Run: vdns install" >&2
  exit 1
fi

RESOLVER_ALREADY=0
COREDNS_ALREADY=0
REDIRECT_ALREADY=0

if vdns_check_port_for_service "HTTP resolver" TCP "${PORT}" "dist/index.js"; then
  :
else
  status=$?
  [[ "${status}" -eq 2 ]] && RESOLVER_ALREADY=1 || exit "${status}"
fi

if vdns_check_port_for_service "CoreDNS" TCP "${VNS_DNS_PORT}" "coredns-vns"; then
  :
else
  status=$?
  [[ "${status}" -eq 2 ]] && COREDNS_ALREADY=1 || exit "${status}"
fi
if vdns_check_port_for_service "CoreDNS" UDP "${VNS_DNS_PORT}" "coredns-vns"; then
  :
else
  status=$?
  [[ "${status}" -eq 2 ]] && COREDNS_ALREADY=1 || exit "${status}"
fi

if vdns_check_port_for_service "HTTP redirect" TCP 80 "dist/redirect-index.js"; then
  :
else
  status=$?
  [[ "${status}" -eq 2 ]] && REDIRECT_ALREADY=1 || exit "${status}"
fi

GUI_DOMAIN="$(vdns_launchd_gui_domain)"
echo "Starting vDNS LaunchAgents in ${GUI_DOMAIN}"
if [[ "${RESOLVER_ALREADY}" == "1" ]]; then
  echo "${VDNS_RESOLVER_LABEL}: matching vDNS resolver is already running; skipping bootstrap"
else
  vdns_bootstrap_job "${GUI_DOMAIN}" "${VDNS_RESOLVER_LABEL}" "$(vdns_resolver_plist)"
fi
if [[ "${COREDNS_ALREADY}" == "1" ]]; then
  echo "${VDNS_COREDNS_LABEL}: matching vDNS CoreDNS is already running; skipping bootstrap"
else
  vdns_bootstrap_job "${GUI_DOMAIN}" "${VDNS_COREDNS_LABEL}" "$(vdns_coredns_plist)"
fi

echo "Starting vDNS LaunchDaemon in system; sudo may prompt."
if [[ "${REDIRECT_ALREADY}" == "1" ]]; then
  echo "${VDNS_REDIRECT_LABEL}: matching vDNS redirect is already running; skipping bootstrap"
else
  vdns_bootstrap_job "system" "${VDNS_REDIRECT_LABEL}" "$(vdns_redirect_plist)" 1
fi

echo
echo "vDNS launchd services started."
echo "Check status with: vdns service-status"
