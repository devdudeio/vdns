#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true

VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
PID_DIR="${REPO_ROOT}/.vdns/pids"

echo "Stopping local vDNS stack"
vdns_stop_pid_file "${PID_DIR}/resolver.pid" "dist/index.js" "HTTP resolver"

if [[ -f "${PID_DIR}/coredns.pid" ]]; then
  vdns_stop_pid_file "${PID_DIR}/coredns.pid" "coredns-vns" "CoreDNS"
else
  PIDS="$(vdns_listener_pids_matching TCP "${VNS_DNS_PORT}" "coredns-vns")"
  if [[ -z "${PIDS}" ]]; then
    PIDS="$(vdns_listener_pids_matching UDP "${VNS_DNS_PORT}" "coredns-vns")"
  fi
  if [[ -z "${PIDS}" ]]; then
    echo "CoreDNS: no coredns-vns listener found on ${VNS_DNS_PORT}"
  else
    for pid in ${PIDS}; do
      echo "CoreDNS: stopping listener PID ${pid}"
      kill -TERM "${pid}" 2>/dev/null || true
    done
  fi
fi

echo "Stopping port 80 redirect service; sudo may prompt if it is running."
sudo "${SCRIPT_DIR}/stop-redirect-port80.sh" || true

echo
echo "vDNS services stopped. /etc/resolver/${VNS_TLD:-vrsc} was left installed."
