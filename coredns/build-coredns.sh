#!/usr/bin/env bash
set -euo pipefail

COREDNS_VERSION="${COREDNS_VERSION:-v1.12.1}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${ROOT_DIR}/.coredns-build"
OUT="${ROOT_DIR}/coredns/coredns-vdns"

rm -rf "${WORK_DIR}"
git clone --depth 1 --branch "${COREDNS_VERSION}" https://github.com/coredns/coredns.git "${WORK_DIR}"

cd "${WORK_DIR}"

if ! grep -q '^vdns:' plugin.cfg; then
  awk '
    /^whoami:/ && !inserted {
      print "vdns:github.com/devdudeio/vdns/coredns/plugin/vdns"
      inserted=1
    }
    { print }
    END {
      if (!inserted) {
        print "vdns:github.com/devdudeio/vdns/coredns/plugin/vdns"
      }
    }
  ' plugin.cfg > plugin.cfg.tmp
  mv plugin.cfg.tmp plugin.cfg
fi

go mod edit -require=github.com/devdudeio/vdns/coredns/plugin/vdns@v0.0.0
go mod edit -replace=github.com/devdudeio/vdns/coredns/plugin/vdns="${ROOT_DIR}/coredns/plugin/vdns"
go generate
go build -o "${OUT}"

echo "Built ${OUT}"
