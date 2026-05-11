#!/usr/bin/env bash
set -euo pipefail

YES=0
PURGE=0
for arg in "$@"; do
  case "${arg}" in
    --yes) YES=1 ;;
    --purge) PURGE=1 ;;
    -h|--help)
      echo "Usage: $0 [--yes] [--purge]"
      exit 0
      ;;
    *) echo "Unknown option: ${arg}" >&2; exit 1 ;;
  esac
done

if [[ "${YES}" -ne 1 ]]; then
  read -r -p "Reinstall vdns through Homebrew on this Mac? [y/N] " answer
  [[ "${answer}" == "y" || "${answer}" == "Y" ]] || exit 1
fi

ENV_FILE="${VDNS_ENV_FILE:-${HOME}/.vdns/.env.local}"
BACKUP=""
if [[ -f "${ENV_FILE}" && "${PURGE}" -ne 1 ]]; then
  BACKUP="$(mktemp /tmp/vdns-env.XXXXXX)"
  cp "${ENV_FILE}" "${BACKUP}"
  chmod 600 "${BACKUP}"
fi

vdns stop || true
vdns uninstall || true
brew uninstall vdns || true
brew update
brew install vdns

if [[ -n "${BACKUP}" ]]; then
  mkdir -p "$(dirname "${ENV_FILE}")"
  cp "${BACKUP}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
fi

vdns https init-ca || true
vdns https install-ca
vdns install
vdns start
vdns doctor --strict --https
vdns demo
