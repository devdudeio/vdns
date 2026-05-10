#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/vdns-lib.sh"

vdns_require_darwin
REPO_ROOT="$(vdns_repo_root)"
cd "${REPO_ROOT}"

if ! vdns_load_env "${REPO_ROOT}" >/dev/null; then
  echo "Create ${VDNS_ENV_FILE} first. Run: vdns setup" >&2
  exit 1
fi

ENTRYPOINT="${REPO_ROOT}/dist/index.js"
if [[ ! -f "${ENTRYPOINT}" ]]; then
  echo "Missing built resolver entrypoint: ${ENTRYPOINT}" >&2
  echo "Run: pnpm build" >&2
  exit 1
fi

if ! NODE_BIN="$(vdns_find_node)"; then
  echo "Could not find node. Set NODE_BIN=/path/to/node in the launchd environment or reinstall services." >&2
  exit 1
fi

exec "${NODE_BIN}" "${ENTRYPOINT}"
