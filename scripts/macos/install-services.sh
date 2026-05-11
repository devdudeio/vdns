#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-services-lib.sh"

DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --) ;;
    --dry-run) DRY_RUN=1 ;;
    *)
      echo "Usage: $0 [--dry-run]" >&2
      exit 1
      ;;
  esac
done

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"
vdns_require_launchd_accessible_repo "${REPO_ROOT}"

if [[ ! -f "${VDNS_ENV_FILE}" ]]; then
  echo "Create ${VDNS_ENV_FILE} first. Run: vdns setup" >&2
  exit 1
fi

vdns_load_env "${REPO_ROOT}" >/dev/null
VDNS_TLD="${VDNS_TLD:-vdns}"
VDNS_DNS_PORT="${VDNS_DNS_PORT:-1053}"
LOG_DIR="$(vdns_service_log_dir "${REPO_ROOT}")"
NODE_BIN="$(vdns_find_node || true)"

vdns_require_file "${REPO_ROOT}/dist/index.js" "Missing built resolver entrypoint: dist/index.js. Run: pnpm build"
vdns_require_file "${REPO_ROOT}/dist/redirect-index.js" "Missing built redirect service entrypoint: dist/redirect-index.js. Run: pnpm build"
vdns_require_executable "${REPO_ROOT}/coredns/coredns-vdns" "Missing CoreDNS binary: coredns/coredns-vdns. Run: cd coredns && ./build-coredns.sh"
vdns_require_executable "${SCRIPT_DIR}/run-resolver-service.sh" "Missing executable wrapper: scripts/macos/run-resolver-service.sh"
vdns_require_executable "${SCRIPT_DIR}/run-coredns-service.sh" "Missing executable wrapper: scripts/macos/run-coredns-service.sh"
vdns_require_executable "${SCRIPT_DIR}/run-redirect-service.sh" "Missing executable wrapper: scripts/macos/run-redirect-service.sh"

if [[ -z "${NODE_BIN}" ]]; then
  echo "Could not find node. Install Node or set NODE_BIN=/path/to/node before installing services." >&2
  exit 1
fi

RESOLVER_PLIST="$(vdns_resolver_plist)"
COREDNS_PLIST="$(vdns_coredns_plist)"
REDIRECT_PLIST="$(vdns_redirect_plist)"

RESOLVER_CONTENT="$(vdns_generate_plist "${VDNS_RESOLVER_LABEL}" "${SCRIPT_DIR}/run-resolver-service.sh" "${REPO_ROOT}" "${LOG_DIR}/resolver.launchd.log" "${LOG_DIR}/resolver.launchd.err" "${NODE_BIN}")"
COREDNS_CONTENT="$(vdns_generate_plist "${VDNS_COREDNS_LABEL}" "${SCRIPT_DIR}/run-coredns-service.sh" "${REPO_ROOT}/coredns" "${LOG_DIR}/coredns.launchd.log" "${LOG_DIR}/coredns.launchd.err")"
REDIRECT_CONTENT="$(vdns_generate_plist "${VDNS_REDIRECT_LABEL}" "${SCRIPT_DIR}/run-redirect-service.sh" "${REPO_ROOT}" "${LOG_DIR}/redirect.launchd.log" "${LOG_DIR}/redirect.launchd.err" "${NODE_BIN}")"

echo "Installing vDNS launchd services"
echo "VDNS_HOME: ${REPO_ROOT}"
echo "State: ${VDNS_STATE_DIR}"
echo "Env: ${VDNS_ENV_FILE}"
echo "Logs: ${LOG_DIR}"
echo "User LaunchAgents:"
echo "  ${RESOLVER_PLIST}"
echo "  ${COREDNS_PLIST}"
echo "Root LaunchDaemon:"
echo "  ${REDIRECT_PLIST}"

vdns_lint_plist_content "${VDNS_RESOLVER_LABEL}" "${RESOLVER_CONTENT}"
vdns_lint_plist_content "${VDNS_COREDNS_LABEL}" "${COREDNS_CONTENT}"
vdns_lint_plist_content "${VDNS_REDIRECT_LABEL}" "${REDIRECT_CONTENT}"

if [[ "${DRY_RUN}" == "1" ]]; then
  echo
  echo "Dry run: no LaunchAgents, LaunchDaemons, or /etc/resolver files will be written."
  echo
  echo "--- ${RESOLVER_PLIST} ---"
  printf '%s\n' "${RESOLVER_CONTENT}"
  echo
  echo "--- ${COREDNS_PLIST} ---"
  printf '%s\n' "${COREDNS_CONTENT}"
  echo
  echo "--- ${REDIRECT_PLIST} ---"
  printf '%s\n' "${REDIRECT_CONTENT}"
  if vdns_resolver_file_is_current "${VDNS_TLD}" "${VDNS_DNS_PORT}"; then
    echo "/etc/resolver/${VDNS_TLD}: already current"
  else
    echo "/etc/resolver/${VDNS_TLD}: would install via scripts/macos/install-vdns-resolver.sh"
  fi
  exit 0
fi

mkdir -p "${LOG_DIR}"

if vdns_resolver_file_is_current "${VDNS_TLD}" "${VDNS_DNS_PORT}"; then
  echo "/etc/resolver/${VDNS_TLD}: already current"
else
  echo "Installing /etc/resolver/${VDNS_TLD}; sudo may prompt."
  sudo VDNS_TLD="${VDNS_TLD}" VDNS_DNS_PORT="${VDNS_DNS_PORT}" "${SCRIPT_DIR}/install-vdns-resolver.sh"
fi

vdns_install_user_plist "${RESOLVER_PLIST}" "${RESOLVER_CONTENT}"
vdns_install_user_plist "${COREDNS_PLIST}" "${COREDNS_CONTENT}"
echo "Installed user LaunchAgents."

echo "Installing root LaunchDaemon; sudo may prompt."
vdns_install_root_plist "${REDIRECT_PLIST}" "${REDIRECT_CONTENT}"

echo
echo "vDNS launchd services installed."
echo "Start them with: vdns start"
