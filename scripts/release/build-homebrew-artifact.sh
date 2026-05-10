#!/usr/bin/env bash
set -euo pipefail

ALLOW_DIRTY=0
SKIP_TESTS=0
for arg in "$@"; do
  case "${arg}" in
    --dirty) ALLOW_DIRTY=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help)
      echo "Usage: scripts/release/build-homebrew-artifact.sh [--dirty] [--skip-tests]"
      exit 0
      ;;
    *) echo "Unknown option: ${arg}" >&2; exit 1 ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"
export CI=1

if [[ "${ALLOW_DIRTY}" != "1" && -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit changes or pass --dirty." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
NAME="vdns-${VERSION}"
RELEASE_ROOT="${REPO_ROOT}/.release"
STAGING="${RELEASE_ROOT}/${NAME}"
OUT_DIR="${REPO_ROOT}/dist-release"
TARBALL="${OUT_DIR}/${NAME}.tar.gz"

pnpm install --frozen-lockfile --force
pnpm build
if [[ "${SKIP_TESTS}" != "1" ]]; then
  pnpm test
fi

if [[ ! -x "coredns/coredns-vns" ]]; then
  echo "CoreDNS binary missing; building coredns/coredns-vns"
  (cd coredns && ./build-coredns.sh)
fi

rm -rf "${STAGING}" "${TARBALL}"
mkdir -p "${STAGING}" "${OUT_DIR}"

copy_path() {
  local path="$1"
  if [[ -e "${path}" ]]; then
    mkdir -p "${STAGING}/$(dirname "${path}")"
    cp -R "${path}" "${STAGING}/${path}"
  fi
}

for path in \
  bin \
  dist \
  coredns \
  scripts \
  docs \
  packaging \
  package.json \
  pnpm-lock.yaml \
  README.md \
  LICENSE \
  .env.example \
  .env.mock.example \
  .env.vdns.local.example; do
  copy_path "${path}"
done

pnpm --dir "${STAGING}" install --prod --frozen-lockfile
rm -rf "${STAGING}/coredns/.git" \
  "${STAGING}/coredns/plugin/vns/.git" \
  "${STAGING}/coredns/plugin/vns/.cache" \
  "${STAGING}/.vdns"
find "${STAGING}" -name '.DS_Store' -delete

chmod +x "${STAGING}/bin/vdns" "${STAGING}"/scripts/macos/*.sh "${STAGING}"/scripts/release/*.sh 2>/dev/null || true

tar -C "${RELEASE_ROOT}" -czf "${TARBALL}" "${NAME}"
SHA256="$(shasum -a 256 "${TARBALL}" | awk '{print $1}')"

cat <<SUMMARY
Built ${TARBALL}
sha256 ${SHA256}

Formula update:
  url "https://github.com/devdudeio/vdns/releases/download/v${VERSION}/${NAME}.tar.gz"
  sha256 "${SHA256}"
SUMMARY
