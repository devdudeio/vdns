#!/usr/bin/env bash

vdns_paths_resolve() {
  local source_path="$1"
  if command -v perl >/dev/null 2>&1; then
    perl -MCwd=abs_path -e 'print abs_path(shift)' "${source_path}"
  else
    local dir base
    dir="$(cd "$(dirname "${source_path}")" && pwd)"
    base="$(basename "${source_path}")"
    echo "${dir}/${base}"
  fi
}

vdns_paths_init() {
  local helper_path helper_dir detected_home

  helper_path="$(vdns_paths_resolve "${BASH_SOURCE[0]}")"
  helper_dir="$(cd "$(dirname "${helper_path}")" && pwd)"

  if [[ -n "${VDNS_HOME:-}" ]]; then
    detected_home="${VDNS_HOME}"
  else
    detected_home="$(cd "${helper_dir}/../.." && pwd)"
  fi

  VDNS_HOME="$(cd "${detected_home}" && pwd)"
  case "${VDNS_HOME}" in
    */Cellar/vdns/*|*/opt/vdns|*/opt/vdns/*)
      VDNS_INSTALL_MODE="homebrew"
      ;;
    *)
      VDNS_INSTALL_MODE="checkout"
      ;;
  esac

  if [[ -z "${VDNS_STATE_DIR:-}" ]]; then
    if [[ "${VDNS_INSTALL_MODE}" == "homebrew" ]]; then
      VDNS_STATE_DIR="${HOME}/.vdns"
    else
      VDNS_STATE_DIR="${VDNS_HOME}/.vdns"
    fi
  fi

  VDNS_LOG_DIR="${VDNS_LOG_DIR:-${VDNS_STATE_DIR}/logs}"
  VDNS_PID_DIR="${VDNS_PID_DIR:-${VDNS_STATE_DIR}/pids}"

  if [[ -z "${VDNS_ENV_FILE:-}" ]]; then
    if [[ "${VDNS_INSTALL_MODE}" == "homebrew" ]]; then
      VDNS_ENV_FILE="${VDNS_STATE_DIR}/.env.local"
    else
      VDNS_ENV_FILE="${VDNS_HOME}/.env.local"
    fi
  fi

  export VDNS_HOME VDNS_INSTALL_MODE VDNS_STATE_DIR VDNS_ENV_FILE VDNS_LOG_DIR VDNS_PID_DIR
}

vdns_paths_init
