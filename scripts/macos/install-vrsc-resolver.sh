#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is macOS-only." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This installer must run as root. Try: sudo $0" >&2
  exit 1
fi

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
RESOLVER_DIR="/etc/resolver"
RESOLVER_FILE="${RESOLVER_DIR}/${VNS_TLD}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

case "${VNS_TLD}" in
  ""|*/*)
    echo "VNS_TLD must be a non-empty resolver name without slashes." >&2
    exit 1
    ;;
esac

case "${VNS_DNS_PORT}" in
  ''|*[!0-9]*)
    echo "VNS_DNS_PORT must be a numeric port." >&2
    exit 1
    ;;
esac

mkdir -p "${RESOLVER_DIR}"

if [[ -e "${RESOLVER_FILE}" ]] && ! grep -q "Managed by VNS" "${RESOLVER_FILE}"; then
  BACKUP_FILE="${RESOLVER_FILE}.backup.${TIMESTAMP}"
  if ! cp -p "${RESOLVER_FILE}" "${BACKUP_FILE}"; then
    echo "Refusing to overwrite unmanaged resolver file because backup failed: ${RESOLVER_FILE}" >&2
    exit 1
  fi
  echo "Backed up unmanaged resolver file to ${BACKUP_FILE}"
fi

{
  echo "# Managed by VNS"
  echo "# Generated at ${GENERATED_AT}"
  echo "domain ${VNS_TLD}"
  echo "nameserver 127.0.0.1"
  echo "port ${VNS_DNS_PORT}"
} > "${RESOLVER_FILE}"

chmod 0644 "${RESOLVER_FILE}"

echo "Installed macOS split-DNS resolver:"
echo "  domain: ${VNS_TLD}"
echo "  file: ${RESOLVER_FILE}"
echo "  nameserver: 127.0.0.1"
echo "  port: ${VNS_DNS_PORT}"
echo
echo "Verify with:"
echo "  scutil --dns | grep -A5 'domain   : ${VNS_TLD}'"
echo "  dig google.${VNS_TLD} A +short"
echo "  dig google.com A +short"
