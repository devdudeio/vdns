#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This status check is macOS-only." >&2
  exit 1
fi

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_DNS_PORT="${VNS_DNS_PORT:-1053}"
RESOLVER_FILE="/etc/resolver/${VNS_TLD}"

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

echo "macOS vDNS split-DNS status"
echo "domain: ${VNS_TLD}"
echo "expected resolver: 127.0.0.1:${VNS_DNS_PORT}"
echo

if [[ -f "${RESOLVER_FILE}" ]]; then
  echo "Resolver file found: ${RESOLVER_FILE}"
  sed 's/^/  /' "${RESOLVER_FILE}"
else
  echo "Resolver file not found: ${RESOLVER_FILE}"
fi

echo
if command -v lsof >/dev/null 2>&1; then
  echo "UDP listeners on 127.0.0.1:${VNS_DNS_PORT}:"
  lsof -nP -iUDP@127.0.0.1:"${VNS_DNS_PORT}" || true
  echo
  echo "UDP listeners on port ${VNS_DNS_PORT}:"
  lsof -nP -iUDP:"${VNS_DNS_PORT}" || true
  echo
  echo "TCP listeners on 127.0.0.1:${VNS_DNS_PORT}:"
  lsof -nP -iTCP@127.0.0.1:"${VNS_DNS_PORT}" -sTCP:LISTEN || true
else
  echo "lsof is not available; skipping listener checks."
fi

echo
echo "macOS resolver verification:"
echo "  scutil --dns | grep -A5 'domain   : ${VNS_TLD}'"
echo "  dig google.${VNS_TLD} A +short"
echo "  dig google.com A +short"
