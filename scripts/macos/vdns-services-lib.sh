#!/usr/bin/env bash

VDNS_RESOLVER_LABEL="$(vdns_launchd_resolver_label)"
VDNS_COREDNS_LABEL="$(vdns_launchd_coredns_label)"
VDNS_REDIRECT_LABEL="$(vdns_launchd_redirect_label)"

vdns_service_log_dir() {
  echo "${VDNS_LOG_DIR}"
}

vdns_service_pid_dir() {
  echo "${VDNS_PID_DIR}"
}

vdns_repo_is_tcc_protected() {
  local root="$1"
  case "${root}" in
    "${HOME}/Desktop"|\
    "${HOME}/Desktop/"*|\
    "${HOME}/Documents"|\
    "${HOME}/Documents/"*|\
    "${HOME}/Downloads"|\
    "${HOME}/Downloads/"*|\
    "${HOME}/Library/Mobile Documents"|\
    "${HOME}/Library/Mobile Documents/"*)
      return 0
      ;;
  esac
  return 1
}

vdns_require_launchd_accessible_repo() {
  local root="$1"

  if [[ "${VDNS_ALLOW_TCC_PROTECTED_REPO:-0}" == "1" || "${VDNS_INSTALL_MODE:-checkout}" == "homebrew" ]]; then
    return 0
  fi

  if vdns_repo_is_tcc_protected "${root}"; then
    cat >&2 <<MESSAGE
This checkout is under a macOS privacy-protected folder:
  ${root}

launchd background jobs cannot reliably execute scripts from Desktop, Documents,
Downloads, or iCloud Drive folders without extra Full Disk Access grants. Move
the repo to a developer folder such as ~/Developer/vns, then reinstall services.

To bypass this guard anyway, set VDNS_ALLOW_TCC_PROTECTED_REPO=1.
MESSAGE
    exit 1
  fi
}

vdns_resolver_plist() {
  vdns_launch_agent_plist "${VDNS_RESOLVER_LABEL}"
}

vdns_coredns_plist() {
  vdns_launch_agent_plist "${VDNS_COREDNS_LABEL}"
}

vdns_redirect_plist() {
  vdns_launch_daemon_plist "${VDNS_REDIRECT_LABEL}"
}

vdns_generate_plist() {
  local label="$1"
  local program="$2"
  local working_dir="$3"
  local stdout_path="$4"
  local stderr_path="$5"
  local node_bin="${6:-}"
  local escaped_label escaped_program escaped_working_dir escaped_stdout escaped_stderr escaped_node
  local escaped_vdns_home escaped_vdns_state_dir escaped_vdns_env_file escaped_vdns_log_dir escaped_vdns_pid_dir

  escaped_label="$(vdns_xml_escape "${label}")"
  escaped_program="$(vdns_xml_escape "${program}")"
  escaped_working_dir="$(vdns_xml_escape "${working_dir}")"
  escaped_stdout="$(vdns_xml_escape "${stdout_path}")"
  escaped_stderr="$(vdns_xml_escape "${stderr_path}")"
  escaped_node="$(vdns_xml_escape "${node_bin}")"
  escaped_vdns_home="$(vdns_xml_escape "${VDNS_HOME}")"
  escaped_vdns_state_dir="$(vdns_xml_escape "${VDNS_STATE_DIR}")"
  escaped_vdns_env_file="$(vdns_xml_escape "${VDNS_ENV_FILE}")"
  escaped_vdns_log_dir="$(vdns_xml_escape "${VDNS_LOG_DIR}")"
  escaped_vdns_pid_dir="$(vdns_xml_escape "${VDNS_PID_DIR}")"

  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escaped_label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escaped_program}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escaped_working_dir}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escaped_stdout}</string>
  <key>StandardErrorPath</key>
  <string>${escaped_stderr}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>VDNS_HOME</key>
    <string>${escaped_vdns_home}</string>
    <key>VDNS_STATE_DIR</key>
    <string>${escaped_vdns_state_dir}</string>
    <key>VDNS_ENV_FILE</key>
    <string>${escaped_vdns_env_file}</string>
    <key>VDNS_LOG_DIR</key>
    <string>${escaped_vdns_log_dir}</string>
    <key>VDNS_PID_DIR</key>
    <string>${escaped_vdns_pid_dir}</string>
PLIST

  if [[ -n "${node_bin}" ]]; then
    cat <<PLIST
    <key>NODE_BIN</key>
    <string>${escaped_node}</string>
PLIST
  fi

  cat <<PLIST
  </dict>
</dict>
</plist>
PLIST
}

vdns_lint_plist_content() {
  local label="$1"
  local content="$2"
  local temp_file

  if ! command -v plutil >/dev/null 2>&1; then
    echo "${label}: plutil not available; skipping plist lint"
    return 0
  fi

  temp_file="/tmp/${label}.$$.$RANDOM.plist"
  printf '%s\n' "${content}" > "${temp_file}"
  plutil -lint "${temp_file}"
  rm -f "${temp_file}"
}

vdns_install_user_plist() {
  local path="$1"
  local content="$2"

  mkdir -p "$(dirname "${path}")"
  printf '%s\n' "${content}" > "${path}"
  chmod 0644 "${path}"
}

vdns_install_root_plist() {
  local path="$1"
  local content="$2"
  local temp_file

  temp_file="$(mktemp "/tmp/$(basename "${path}").XXXXXX")"
  printf '%s\n' "${content}" > "${temp_file}"
  chmod 0644 "${temp_file}"
  sudo mkdir -p "$(dirname "${path}")"
  sudo cp "${temp_file}" "${path}"
  sudo chown root:wheel "${path}"
  sudo chmod 0644 "${path}"
  rm -f "${temp_file}"
}

vdns_resolver_file_is_current() {
  local tld="$1"
  local dns_port="$2"
  local resolver_file="/etc/resolver/${tld}"

  [[ -f "${resolver_file}" ]] &&
    grep -Eq "^nameserver[[:space:]]+127\\.0\\.0\\.1$" "${resolver_file}" &&
    grep -Eq "^port[[:space:]]+${dns_port}$" "${resolver_file}"
}

vdns_print_port_conflict() {
  local label="$1"
  local protocol="$2"
  local port="$3"

  echo "${label}: ${protocol} port ${port} is occupied by an unrelated process:" >&2
  vdns_port_owner_lines "${protocol}" "${port}" >&2
}

vdns_check_port_for_service() {
  local label="$1"
  local protocol="$2"
  local port="$3"
  local needle="$4"
  local owners pids pid command_line

  owners="$(vdns_port_owner_lines "${protocol}" "${port}")"
  if [[ -z "${owners}" ]]; then
    return 0
  fi

  pids="$(printf '%s\n' "${owners}" | awk '{ print $2 }' | sort -u)"
  for pid in ${pids}; do
    command_line="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ "${command_line}" != *"${needle}"* ]]; then
      vdns_print_port_conflict "${label}" "${protocol}" "${port}"
      return 1
    fi
  done

  echo "${label}: ${protocol} port ${port} is already owned by vDNS"
  return 2
}

vdns_bootstrap_job() {
  local domain="$1"
  local label="$2"
  local plist="$3"
  local use_sudo="${4:-0}"

  if [[ "${use_sudo}" == "1" ]]; then
    if sudo launchctl print "${domain}/${label}" >/dev/null 2>&1; then
      echo "${label}: already bootstrapped"
    elif ! sudo launchctl bootstrap "${domain}" "${plist}"; then
      if sudo launchctl print "${domain}/${label}" >/dev/null 2>&1; then
        echo "${label}: already bootstrapped"
      else
        echo "${label}: launchctl bootstrap failed" >&2
        return 1
      fi
    fi
    sudo launchctl kickstart -k "${domain}/${label}"
    return $?
  fi

  if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
    echo "${label}: already bootstrapped"
  elif ! launchctl bootstrap "${domain}" "${plist}"; then
    if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
      echo "${label}: already bootstrapped"
    else
      echo "${label}: launchctl bootstrap failed" >&2
      return 1
    fi
  fi
  launchctl kickstart -k "${domain}/${label}"
}

vdns_bootout_job() {
  local domain="$1"
  local label="$2"
  local use_sudo="${3:-0}"

  if [[ "${use_sudo}" == "1" ]]; then
    if ! sudo launchctl print "${domain}/${label}" >/dev/null 2>&1; then
      echo "${label}: already stopped"
      return 0
    fi
    sudo launchctl bootout "${domain}/${label}" || {
      if sudo launchctl print "${domain}/${label}" >/dev/null 2>&1; then
        echo "${label}: launchctl bootout failed" >&2
        return 1
      fi
      echo "${label}: already stopped"
    }
    return 0
  fi

  if ! launchctl print "${domain}/${label}" >/dev/null 2>&1; then
    echo "${label}: already stopped"
    return 0
  fi
  launchctl bootout "${domain}/${label}" || {
    if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
      echo "${label}: launchctl bootout failed" >&2
      return 1
    fi
    echo "${label}: already stopped"
  }
}

vdns_print_launchd_redirect_state() {
  if sudo -n launchctl print "system/${VDNS_REDIRECT_LABEL}" >/dev/null 2>&1; then
    echo "launchd redirect service:"
    sudo -n launchctl print "system/${VDNS_REDIRECT_LABEL}" |
      awk '
        /^[[:space:]]*state = / ||
        /^[[:space:]]*pid = / ||
        /^[[:space:]]*last exit code = / { print "  " $0 }
      '
  else
    echo "launchd redirect service: sudo required for status, or not installed"
  fi
}
