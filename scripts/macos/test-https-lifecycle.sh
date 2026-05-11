#!/usr/bin/env bash
set -euo pipefail

OPEN_BROWSER=0
if [[ "${1:-}" == "--open" ]]; then
  OPEN_BROWSER=1
fi

VDNS_BIN="${VDNS_BIN:-vdns}"
TLD="${VNS_TLD:-vrsc}"
A_DOMAIN="${VDNS_DOCTOR_A_DOMAIN:-verus.${TLD}}"
REDIRECT_DOMAIN="${VDNS_DOCTOR_REDIRECT_DOMAIN:-chainvue.${TLD}}"
PROXY_DOMAIN="${VDNS_DOCTOR_PROXY_DOMAIN:-verus.${TLD}}"

run() {
  echo "+ $*"
  "$@"
}

run "${VDNS_BIN}" https status
run "${VDNS_BIN}" https verify
run "${VDNS_BIN}" doctor --strict --https
run curl -I --max-time 20 "https://${PROXY_DOMAIN}"
run curl -I --max-time 10 "http://${A_DOMAIN}"
run curl -I --max-time 10 "http://${REDIRECT_DOMAIN}"
run curl -I --max-time 20 "https://${REDIRECT_DOMAIN}"

if [[ "${OPEN_BROWSER}" -eq 1 ]]; then
  run open "https://${PROXY_DOMAIN}"
fi
