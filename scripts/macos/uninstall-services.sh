#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-services-lib.sh"

REMOVE_RESOLVER=0
PURGE=0
for arg in "$@"; do
  case "${arg}" in
    --) ;;
    --remove-resolver) REMOVE_RESOLVER=1 ;;
    --purge) PURGE=1 ;;
    *)
      echo "Usage: $0 [--remove-resolver] [--purge]" >&2
      exit 1
      ;;
  esac
done

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_load_env "${REPO_ROOT}" >/dev/null || true
VNS_TLD="${VNS_TLD:-vrsc}"

"${SCRIPT_DIR}/stop-services.sh"

echo "Removing launchd plist files"
rm -f "$(vdns_resolver_plist)" "$(vdns_coredns_plist)"
if [[ -f "$(vdns_redirect_plist)" ]]; then
  echo "Removing root LaunchDaemon; sudo may prompt."
  sudo rm -f "$(vdns_redirect_plist)"
fi

if [[ "${REMOVE_RESOLVER}" == "1" ]]; then
  echo "Removing /etc/resolver/${VNS_TLD}; sudo may prompt."
  sudo VNS_TLD="${VNS_TLD}" "${SCRIPT_DIR}/uninstall-vrsc-resolver.sh"
else
  echo "Leaving /etc/resolver/${VNS_TLD} installed."
fi

if [[ "${PURGE}" == "1" ]]; then
  echo "Removing .vdns logs and pids."
  rm -rf "${REPO_ROOT}/.vdns/logs" "${REPO_ROOT}/.vdns/pids"
fi

echo
echo "vDNS launchd services uninstalled. .env.local was preserved."
