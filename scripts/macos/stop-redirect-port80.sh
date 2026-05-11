#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This helper is macOS-only." >&2
  exit 1
fi

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Stopping processes on port 80 may require administrator privileges." >&2
  echo "Run: sudo $0" >&2
  exit 1
fi

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof is required to inspect port 80 listeners." >&2
  exit 1
fi

echo "Inspecting TCP listeners on port 80"
LISTENERS="$(lsof -nP -iTCP:80 -sTCP:LISTEN || true)"
if [[ -z "${LISTENERS}" ]]; then
  echo "No TCP listener found on port 80."
  exit 0
fi

echo "${LISTENERS}"
echo

PIDS="$(
  echo "${LISTENERS}" |
    awk 'NR > 1 && $1 == "node" { print $2 }' |
    sort -u
)"

if [[ -z "${PIDS}" ]]; then
  echo "No node-based listener found on port 80. Refusing to stop unrelated service." >&2
  exit 1
fi

MATCHED_PIDS=""
for pid in ${PIDS}; do
  COMMAND_LINE="$(ps -p "${pid}" -o command= || true)"
  if [[ "${COMMAND_LINE}" == *"dist/redirect-index.js"* ]] || [[ "${COMMAND_LINE}" == *"redirect-index.js"* ]]; then
    MATCHED_PIDS="${MATCHED_PIDS} ${pid}"
    echo "Matched vDNS gateway process ${pid}: ${COMMAND_LINE}"
  else
    echo "Skipping node process ${pid}; it does not look like the vDNS gateway: ${COMMAND_LINE}"
  fi
done

if [[ -z "${MATCHED_PIDS// }" ]]; then
  echo "No vDNS gateway process found on port 80. Refusing to stop unrelated service." >&2
  exit 1
fi

for pid in ${MATCHED_PIDS}; do
  echo "Stopping process ${pid}"
  kill -TERM "${pid}"
done

sleep 1

for pid in ${MATCHED_PIDS}; do
  if kill -0 "${pid}" 2>/dev/null; then
    echo "Process ${pid} is still running; sending KILL"
    kill -KILL "${pid}"
  fi
done

echo "Stopped vDNS gateway on port 80."
