#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-services-lib.sh"

vdns_require_darwin

GUI_DOMAIN="$(vdns_launchd_gui_domain)"
echo "Stopping vDNS launchd services"
vdns_bootout_job "system" "${VDNS_REDIRECT_LABEL}" 1
vdns_bootout_job "${GUI_DOMAIN}" "${VDNS_COREDNS_LABEL}"
vdns_bootout_job "${GUI_DOMAIN}" "${VDNS_RESOLVER_LABEL}"

echo
echo "vDNS launchd services stopped. Plist files were left installed."
