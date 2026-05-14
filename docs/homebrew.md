# Homebrew Alpha Packaging

vDNS is packaged for Homebrew through a custom tap, not Homebrew Core.

## Install

```sh
brew tap devdudeio/vdns
brew install vdns
vdns bootstrap
vdns doctor
vdns doctor --strict --https
```

`brew install` only installs files. It does not use `sudo`, install launchd services, write `/etc/resolver`, bind ports `80`/`443`, trust the local HTTPS CA, or start anything. The guided setup path is `vdns bootstrap`.

`vdns bootstrap` creates config, optionally captures write RPC credentials, initializes and trusts the local HTTPS CA, installs launchd services, starts them, and runs verification. It may prompt for `sudo` because CA trust writes the macOS System keychain, the web gateway binds privileged ports, and split-DNS resolver files live under `/etc/resolver`.

## Setup

```sh
vdns bootstrap
```

Homebrew config is written to `~/.vdns/.env.local` with mode `600`. Edit that file to change Verus RPC settings, the root identity, TLD, DNS port, gateway ports, HTTPS settings, or PROXY settings.

Advanced or repair setup remains available:

```sh
vdns setup --force --root vdns@ --tld vdns --rpc-url https://api.verustest.net/
vdns install
vdns start
```

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
dig @127.0.0.1 -p 1053 demo-proxy.vdns A +short
dscacheutil -q host -a name demo-proxy.vdns
curl -i --max-time 10 http://demo-redirect.vdns
curl -I --max-time 20 http://demo-proxy.vdns
```

`demo-redirect.vdns` should return `302` with `Location: https://verus.io/`. `demo-proxy.vdns` should include `x-vdns-proxy: 1` and `x-vdns-proxy-target-host: verus.io`.

On macOS, `dig demo-proxy.vdns` without `@127.0.0.1 -p 1053` may not use `/etc/resolver`. Use `dscacheutil` for system resolver behavior.

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
vdns bootstrap
vdns setup
vdns install
vdns start
vdns status
vdns doctor
vdns https verify
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
   vdns bootstrap
   vdns status
   vdns doctor --strict --https
   ```

## Alpha Limitations

- macOS only.
- Not submitted to Homebrew Core.
- No signed `.pkg` installer.
- No Windows/Linux service installers.
- `vdns bootstrap` may prompt for `sudo` because it installs CA trust, `/etc/resolver/<tld>`, and privileged launchd services.
- PROXY remains best-effort for complex browser sites.
