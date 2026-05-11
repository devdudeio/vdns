#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This uninstaller is macOS-only." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This uninstaller must run as root. Try: sudo $0" >&2
  exit 1
fi

VDNS_TLD="${VDNS_TLD:-vdns}"
RESOLVER_FILE="/etc/resolver/${VDNS_TLD}"

case "${VDNS_TLD}" in
  ""|*/*)
    echo "VDNS_TLD must be a non-empty resolver name without slashes." >&2
    exit 1
    ;;
esac

if [[ ! -e "${RESOLVER_FILE}" ]]; then
  echo "No resolver file found at ${RESOLVER_FILE}"
  exit 0
fi

if ! grep -Eq "Managed by vDNS" "${RESOLVER_FILE}"; then
  echo "Refusing to delete unmanaged resolver file: ${RESOLVER_FILE}" >&2
  exit 1
fi

rm "${RESOLVER_FILE}"
echo "Removed managed vDNS resolver file: ${RESOLVER_FILE}"
