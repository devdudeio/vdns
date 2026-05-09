#!/usr/bin/env bash

vdns_require_darwin() {
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "This helper is macOS-only." >&2
    exit 1
  fi
}

vdns_repo_root() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  cd "${script_dir}/../.." && pwd
}

vdns_load_env() {
  local root="$1"
  local env_file=""

  if [[ -f "${root}/.env.local" ]]; then
    env_file="${root}/.env.local"
  elif [[ -f "${root}/.env.vdns.local" ]]; then
    env_file="${root}/.env.vdns.local"
  else
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
  echo "${env_file}"
}

vdns_require_env() {
  local root="$1"
  local loaded

  if ! loaded="$(vdns_load_env "${root}")"; then
    echo "Missing local vDNS environment." >&2
    echo "Copy the example and edit RPC settings first:" >&2
    echo "  cp .env.vdns.local.example .env.local" >&2
    echo "  \$EDITOR .env.local" >&2
    exit 1
  fi

  echo "Loaded env: ${loaded}"
}

vdns_timeout() {
  local seconds="$1"
  shift

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${seconds}" "$@"
    return $?
  fi

  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}" "$@"
    return $?
  fi

  "$@" &
  local command_pid=$!
  (
    sleep "${seconds}"
    kill -TERM "${command_pid}" 2>/dev/null
    sleep 1
    kill -KILL "${command_pid}" 2>/dev/null
  ) &
  local watchdog_pid=$!

  wait "${command_pid}" 2>/dev/null
  local status=$?
  kill "${watchdog_pid}" 2>/dev/null
  wait "${watchdog_pid}" 2>/dev/null
  return "${status}"
}

vdns_safe_config() {
  echo "VNS_MODE=${VNS_MODE:-rpc}"
  echo "VNS_ROOT_IDENTITY=${VNS_ROOT_IDENTITY:-fum@}"
  echo "VNS_TLD=${VNS_TLD:-vrsc}"
  echo "PORT=${PORT:-8080}"
  echo "VNS_RESOLVER_URL=${VNS_RESOLVER_URL:-http://127.0.0.1:8080}"
  echo "VNS_DNS_PORT=${VNS_DNS_PORT:-1053}"
  echo "VNS_REDIRECT_HOST=${VNS_REDIRECT_HOST:-127.0.0.1}"
  echo "VNS_REDIRECT_PORT=${VNS_REDIRECT_PORT:-8081}"
  if [[ -n "${VERUS_RPC_URL:-}" ]]; then
    echo "VERUS_RPC_URL_CONFIGURED=true"
  else
    echo "VERUS_RPC_URL_CONFIGURED=false"
  fi
  if [[ -n "${VERUS_RPC_USER:-}" || -n "${VERUS_RPC_PASSWORD:-}" ]]; then
    echo "VERUS_RPC_AUTH_CONFIGURED=true"
  else
    echo "VERUS_RPC_AUTH_CONFIGURED=false"
  fi
}

vdns_pid_matches() {
  local pid="$1"
  local needle="$2"
  local command_line

  [[ "${pid}" =~ ^[0-9]+$ ]] || return 1
  command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
  [[ "${command_line}" == *"${needle}"* ]]
}

vdns_stop_pid_file() {
  local pid_file="$1"
  local needle="$2"
  local label="$3"

  if [[ ! -f "${pid_file}" ]]; then
    echo "${label}: no PID file at ${pid_file}"
    return 0
  fi

  local pid
  pid="$(tr -d '[:space:]' < "${pid_file}")"
  if ! vdns_pid_matches "${pid}" "${needle}"; then
    echo "${label}: stale or unrelated PID ${pid}; removing PID file only"
    rm -f "${pid_file}"
    return 0
  fi

  echo "${label}: stopping PID ${pid}"
  kill -TERM "${pid}" 2>/dev/null || true
  sleep 1
  wait "${pid}" 2>/dev/null || true
  if kill -0 "${pid}" 2>/dev/null; then
    kill -KILL "${pid}" 2>/dev/null || true
    wait "${pid}" 2>/dev/null || true
  fi
  rm -f "${pid_file}"
}

vdns_lsof_port() {
  local protocol="$1"
  local port="$2"

  command -v lsof >/dev/null 2>&1 || return 1
  if [[ "${protocol}" == "TCP" ]]; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  else
    lsof -nP -iUDP:"${port}" 2>/dev/null || true
  fi
}

vdns_lsof_port_privileged_if_needed() {
  local protocol="$1"
  local port="$2"
  local output

  command -v lsof >/dev/null 2>&1 || {
    echo "lsof is not available"
    return 0
  }

  output="$(vdns_lsof_port "${protocol}" "${port}")"
  if [[ -n "${output}" ]]; then
    echo "${output}"
    return 0
  fi

  if sudo -n true >/dev/null 2>&1; then
    if [[ "${protocol}" == "TCP" ]]; then
      sudo -n lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
    else
      sudo -n lsof -nP -iUDP:"${port}" 2>/dev/null || true
    fi
  else
    echo "No listener visible as ${USER:-current user}. For privileged ports, run:"
    if [[ "${protocol}" == "TCP" ]]; then
      echo "  sudo lsof -nP -iTCP:${port} -sTCP:LISTEN"
    else
      echo "  sudo lsof -nP -iUDP:${port}"
    fi
  fi
}

vdns_listener_pids_matching() {
  local protocol="$1"
  local port="$2"
  local needle="$3"
  local pids pid command_line

  pids="$(vdns_lsof_port "${protocol}" "${port}" | awk 'NR > 1 { print $2 }' | sort -u)"
  for pid in ${pids}; do
    command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ "${command_line}" == *"${needle}"* ]]; then
      echo "${pid}"
    fi
  done
}

vdns_has_listener_matching() {
  [[ -n "$(vdns_listener_pids_matching "$1" "$2" "$3")" ]]
}

vdns_resolver_url() {
  echo "${VNS_RESOLVER_URL:-http://127.0.0.1:${PORT:-8080}}"
}

vdns_section() {
  echo
  echo "== $1 =="
}

vdns_launchd_gui_domain() {
  echo "gui/$(id -u)"
}

vdns_launchd_resolver_label() {
  echo "io.vdns.resolver"
}

vdns_launchd_coredns_label() {
  echo "io.vdns.coredns"
}

vdns_launchd_redirect_label() {
  echo "io.vdns.redirect"
}

vdns_launch_agent_dir() {
  echo "${HOME}/Library/LaunchAgents"
}

vdns_launch_daemon_dir() {
  echo "/Library/LaunchDaemons"
}

vdns_launch_agent_plist() {
  echo "$(vdns_launch_agent_dir)/$1.plist"
}

vdns_launch_daemon_plist() {
  echo "$(vdns_launch_daemon_dir)/$1.plist"
}

vdns_xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  echo "${value}"
}

vdns_find_node() {
  if [[ -n "${NODE_BIN:-}" && -x "${NODE_BIN}" ]]; then
    echo "${NODE_BIN}"
  elif command -v node >/dev/null 2>&1; then
    command -v node
  elif [[ -x /opt/homebrew/bin/node ]]; then
    echo "/opt/homebrew/bin/node"
  elif [[ -x /usr/local/bin/node ]]; then
    echo "/usr/local/bin/node"
  else
    return 1
  fi
}

vdns_require_file() {
  local path="$1"
  local message="$2"

  if [[ ! -f "${path}" ]]; then
    echo "${message}" >&2
    exit 1
  fi
}

vdns_require_executable() {
  local path="$1"
  local message="$2"

  if [[ ! -x "${path}" ]]; then
    echo "${message}" >&2
    exit 1
  fi
}

vdns_launchctl_print_summary() {
  local domain="$1"
  local label="$2"

  if launchctl print "${domain}/${label}" >/tmp/vdns-launchctl-print.$$ 2>/tmp/vdns-launchctl-print-err.$$; then
    echo "${domain}/${label}: loaded"
    awk '
      /^[[:space:]]*state = / ||
      /^[[:space:]]*pid = / ||
      /^[[:space:]]*last exit code = / ||
      /^[[:space:]]*path = / { print "  " $0 }
    ' /tmp/vdns-launchctl-print.$$
    rm -f /tmp/vdns-launchctl-print.$$ /tmp/vdns-launchctl-print-err.$$
    return 0
  fi

  echo "${domain}/${label}: not loaded"
  rm -f /tmp/vdns-launchctl-print.$$ /tmp/vdns-launchctl-print-err.$$
}

vdns_port_owner_lines() {
  local protocol="$1"
  local port="$2"

  vdns_lsof_port "${protocol}" "${port}" | awk 'NR > 1'
}

vdns_port_has_owner() {
  [[ -n "$(vdns_port_owner_lines "$1" "$2")" ]]
}
