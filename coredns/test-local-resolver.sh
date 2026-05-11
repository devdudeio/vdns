#!/usr/bin/env bash
set -euo pipefail

if ! command -v dig >/dev/null 2>&1; then
  echo "dig is required for this test. Install bind/dnsutils first." >&2
  exit 1
fi

DNS_HOST="${DNS_HOST:-127.0.0.1}"
DNS_PORT="${DNS_PORT:-1053}"

echo "Testing vDNS DNS through ${DNS_HOST}:${DNS_PORT}"
VDNS_OUTPUT="$(dig @"${DNS_HOST}" -p "${DNS_PORT}" google.vdns A +short)"
echo "google.vdns A:"
echo "${VDNS_OUTPUT:-<empty>}"
if [[ -z "${VDNS_OUTPUT}" ]]; then
  echo "Expected google.vdns A to return at least one answer" >&2
  exit 1
fi

NORMAL_OUTPUT="$(dig @"${DNS_HOST}" -p "${DNS_PORT}" google.com A +short)"
echo "google.com A:"
echo "${NORMAL_OUTPUT:-<empty>}"
if [[ -z "${NORMAL_OUTPUT}" ]]; then
  echo "Expected google.com A to return at least one forwarded public DNS answer" >&2
  exit 1
fi

echo "Local resolver smoke test passed"
