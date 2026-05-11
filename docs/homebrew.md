# Homebrew Alpha Packaging

vDNS is packaged for Homebrew through a custom tap, not Homebrew Core.

## Install

```sh
brew tap devdudeio/vdns
brew install vdns
vdns setup
vdns install
vdns start
vdns doctor
vdns demo
```

`brew install` only installs files. It does not use `sudo`, install launchd services, write `/etc/resolver`, bind port `80`, or start anything. Service installation is explicit through `vdns install`.

`vdns install` installs launchd plists and `/etc/resolver/<tld>`. It may prompt for `sudo` because the web gateway runs on local port `80` and split-DNS resolver files live under `/etc/resolver`.

## Setup

```sh
vdns setup \
  --root fum@ \
  --tld vrsc \
  --rpc-url http://127.0.0.1:18843 \
  --rpc-user user \
  --rpc-password pass
```

Homebrew config is written to `~/.vdns/.env.local` with mode `600`. Edit that file to change Verus RPC settings, the root identity, TLD, DNS port, gateway port, or PROXY settings.

## Service Flow

```sh
vdns install
vdns start
vdns status
vdns doctor
vdns demo
vdns logs
```

Useful log commands:

```sh
vdns logs
vdns logs resolver
vdns logs coredns
vdns logs gateway
vdns logs --tail
vdns logs gateway --tail
```

Logs live in `~/.vdns/logs`.

## Demo Checks

```sh
dig @127.0.0.1 -p 1053 google.vrsc A +short
dscacheutil -q host -a name google.vrsc
curl -i --max-time 10 http://chainvue.vrsc
curl -I --max-time 20 http://verus.vrsc
```

`chainvue.vrsc` should return `302` with `Location: http://chainvue.io/`. `verus.vrsc` should include `x-vdns-proxy: 1` and `x-vdns-proxy-target-host: verus.io`.

On macOS, `dig google.vrsc` without `@127.0.0.1 -p 1053` may not use `/etc/resolver`. Use `dscacheutil` for system resolver behavior.

## Upgrade

```sh
brew update
brew upgrade vdns
vdns restart
vdns doctor
```

User state under `~/.vdns` survives Cellar upgrades.

## Stop And Uninstall

```sh
vdns stop
vdns uninstall
brew uninstall vdns
```

`vdns uninstall` removes the launchd services installed by `vdns install`. `brew uninstall vdns` removes Homebrew-managed files. User config and logs under `~/.vdns` are left for inspection or reuse.

## Runtime Paths

Checkout installs use project-local state by default:

```text
VDNS_HOME=<repo checkout>
VDNS_STATE_DIR=<repo checkout>/.vdns
VDNS_ENV_FILE=<repo checkout>/.env.local
```

Homebrew installs use user state that survives Cellar upgrades:

```text
VDNS_HOME=$(brew --prefix vdns)/libexec
VDNS_STATE_DIR=$HOME/.vdns
VDNS_ENV_FILE=$HOME/.vdns/.env.local
VDNS_LOG_DIR=$HOME/.vdns/logs
VDNS_PID_DIR=$HOME/.vdns/pids
```

Override these with `VDNS_HOME`, `VDNS_STATE_DIR`, or `VDNS_ENV_FILE` when needed.

## Command Reference

```sh
vdns --version
vdns help
vdns paths
vdns setup
vdns install
vdns start
vdns status
vdns doctor
vdns demo
vdns logs
vdns stop
vdns uninstall
```

`vdns doctor --strict` promotes demo record, REDIRECT, and PROXY warnings to failures for release or demo validation.

## Tap Maintenance

1. Create the tap repository:
   `github.com/devdudeio/homebrew-vdns`
2. Copy `packaging/homebrew/vdns.rb` to `Formula/vdns.rb` in the tap.
3. Build the release artifact from this repo:

   ```sh
   scripts/release/build-homebrew-artifact.sh
   ```

4. Create a GitHub release in `devdudeio/vdns`, for example `v0.1.3`.
5. Upload `dist-release/vdns-X.Y.Z.tar.gz`.
6. Replace the formula `url` and `sha256` with the values printed by the release script.
7. Test the tap:

   ```sh
   brew tap devdudeio/vdns
   brew install vdns
   vdns --version
   vdns paths
   vdns setup
   vdns install
   vdns start
   vdns demo
   ```

## Alpha Limitations

- macOS only.
- Not submitted to Homebrew Core.
- No signed `.pkg` installer.
- No TLS/local CA support.
- No Windows/Linux service installers.
- `vdns install` may prompt for `sudo` because it installs `/etc/resolver/<tld>` and a port-80 LaunchDaemon.
- PROXY remains best-effort for complex browser sites.
