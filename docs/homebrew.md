# Homebrew Alpha Packaging

vDNS is packaged for Homebrew through a custom tap, not Homebrew Core.

User flow:

```sh
brew tap devdudeio/vdns
brew install vdns
vdns setup
vdns install
vdns start
vdns status
vdns demo
```

`brew install` only installs files. It does not use `sudo`, install launchd services, write `/etc/resolver`, or start anything. Service installation is explicit through `vdns install`.

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

## Commands

```sh
vdns --version
vdns help
vdns paths
vdns setup
vdns install
vdns start
vdns status
vdns demo
vdns logs
vdns stop
vdns uninstall
```

`vdns setup` creates the env file with mode `600`. It can run interactively or with flags:

```sh
vdns setup \
  --root fum@ \
  --tld vrsc \
  --rpc-url http://127.0.0.1:18843 \
  --rpc-user user \
  --rpc-password pass \
  --force
```

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
