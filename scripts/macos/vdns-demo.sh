#!/usr/bin/env bash
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true

VNS_TLD="${VNS_TLD:-vrsc}"
VNS_RESOLVER_URL="$(vdns_resolver_url)"
FAILED=0

run_demo() {
  echo
  echo "$ $*"
  vdns_timeout 10 "$@"
}

echo "vDNS demo"
run_demo dscacheutil -q host -a name "google.${VNS_TLD}"
run_demo dscacheutil -q host -a name "chainvue.${VNS_TLD}"
run_demo curl -fsS --max-time 5 "${VNS_RESOLVER_URL}/resolve-domain/chainvue.${VNS_TLD}?type=REDIRECT"

echo
echo "$ curl -i --max-time 10 http://chainvue.${VNS_TLD}"
OUTPUT="$(vdns_timeout 12 curl -i --max-time 10 "http://chainvue.${VNS_TLD}" 2>&1)"
STATUS=$?
printf '%s\n' "${OUTPUT}"

if [[ "${STATUS}" -ne 0 ]]; then
  FAILED=1
elif ! printf '%s\n' "${OUTPUT}" | grep -Eiq '^HTTP/[^ ]+ 302 '; then
  FAILED=1
elif ! printf '%s\n' "${OUTPUT}" | grep -Eiq '^location: http://chainvue\.io/\r?$'; then
  FAILED=1
fi

echo
if [[ "${FAILED}" -eq 0 ]]; then
  echo "Success: chainvue.${VNS_TLD} returned 302 Location: http://chainvue.io/"
  exit 0
fi

echo "Demo failed: expected 302 Location: http://chainvue.io/"
exit 1
