#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

BINARY="${COREDNS_BIN:-./coredns-vns}"
COREFILE="${COREFILE:-Corefile.vrsc-only.example}"

if [[ ! -x "${BINARY}" ]]; then
  echo "CoreDNS binary not found or not executable: ${BINARY}" >&2
  echo "Build it first with: ./build-coredns.sh" >&2
  exit 1
fi

echo "Starting VNS CoreDNS in vrsc-only mode"
echo "binary: ${BINARY}"
echo "corefile: ${COREFILE}"
echo "handles: .vrsc only on port 1053"

exec "${BINARY}" -conf "${COREFILE}"
