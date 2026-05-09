#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"

if ! vdns_load_env "${REPO_ROOT}" >/dev/null; then
  echo "Create .env.local first. See .env.vdns.local.example." >&2
  exit 1
fi

cd "${REPO_ROOT}/coredns"
if [[ ! -x ./coredns-vns ]]; then
  echo "Missing CoreDNS binary: ${REPO_ROOT}/coredns/coredns-vns" >&2
  echo "Run: cd coredns && ./build-coredns.sh" >&2
  exit 1
fi

exec ./coredns-vns -conf Corefile.local-resolver.example
