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

VNS_TLD="${VNS_TLD:-vrsc}"
RESOLVER_FILE="/etc/resolver/${VNS_TLD}"

case "${VNS_TLD}" in
  ""|*/*)
    echo "VNS_TLD must be a non-empty resolver name without slashes." >&2
    exit 1
    ;;
esac

if [[ ! -e "${RESOLVER_FILE}" ]]; then
  echo "No resolver file found at ${RESOLVER_FILE}"
  exit 0
fi

if ! grep -Eq "Managed by (VNS|vDNS)" "${RESOLVER_FILE}"; then
  echo "Refusing to delete unmanaged resolver file: ${RESOLVER_FILE}" >&2
  exit 1
fi

rm "${RESOLVER_FILE}"
echo "Removed managed vDNS resolver file: ${RESOLVER_FILE}"
