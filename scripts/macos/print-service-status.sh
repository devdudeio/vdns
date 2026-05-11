#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-services-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true

PORT="${PORT:-8080}"
VDNS_DNS_PORT="${VDNS_DNS_PORT:-1053}"
LOG_DIR="${VDNS_LOG_DIR}"
GUI_DOMAIN="$(vdns_launchd_gui_domain)"

echo "vDNS launchd service status"

vdns_section "launchctl"
vdns_launchctl_print_summary "${GUI_DOMAIN}" "${VDNS_RESOLVER_LABEL}"
vdns_launchctl_print_summary "${GUI_DOMAIN}" "${VDNS_COREDNS_LABEL}"
if sudo -n launchctl print "system/${VDNS_REDIRECT_LABEL}" >/dev/null 2>&1; then
  echo "system/${VDNS_REDIRECT_LABEL}: loaded"
  sudo -n launchctl print "system/${VDNS_REDIRECT_LABEL}" |
    awk '
      /^[[:space:]]*state = / ||
      /^[[:space:]]*pid = / ||
      /^[[:space:]]*last exit code = / ||
      /^[[:space:]]*path = / { print "  " $0 }
    '
else
  echo "system/${VDNS_REDIRECT_LABEL}: sudo required for full summary"
  echo "  run: sudo launchctl print system/${VDNS_REDIRECT_LABEL}"
fi

vdns_section "Listeners"
echo "HTTP resolver TCP ${PORT}:"
vdns_lsof_port TCP "${PORT}"
echo
echo "CoreDNS UDP ${VDNS_DNS_PORT}:"
vdns_lsof_port UDP "${VDNS_DNS_PORT}"
echo
echo "CoreDNS TCP ${VDNS_DNS_PORT}:"
vdns_lsof_port TCP "${VDNS_DNS_PORT}"
echo
echo "HTTP redirect TCP 80:"
vdns_lsof_port_privileged_if_needed TCP 80

vdns_section "Logs"
echo "${LOG_DIR}/resolver.launchd.log"
echo "${LOG_DIR}/resolver.launchd.err"
echo "${LOG_DIR}/coredns.launchd.log"
echo "${LOG_DIR}/coredns.launchd.err"
echo "${LOG_DIR}/redirect.launchd.log"
echo "${LOG_DIR}/redirect.launchd.err"

vdns_section "vDNS stack checks"
"${SCRIPT_DIR}/vdns-status.sh"
