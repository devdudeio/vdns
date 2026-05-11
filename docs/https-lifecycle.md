# HTTPS Lifecycle

## Initial Setup

```sh
vdns https init-ca
vdns https install-ca
```

Set `VDNS_HTTPS_ENABLED=true` in `~/.vdns/.env.local`, then restart:

```sh
vdns restart
vdns https verify
vdns doctor --strict --https
```

## After Reboot

```sh
vdns status
vdns https status
vdns https verify
```

`https://verus.vdns` should load without `curl -k`. `http://verus.vdns` should still work, and `http://chainvue.vdns` should still redirect.

## Clean Homebrew Reinstall

Interactive:

```sh
scripts/macos/test-clean-homebrew-install.sh
```

Non-interactive:

```sh
scripts/macos/test-clean-homebrew-install.sh --yes
```

The script preserves `~/.vdns/.env.local` by default. Add `--purge` only when intentionally discarding local config.

## Troubleshooting

If only `curl -k https://verus.vdns` works, the local CA is not trusted for TLS. Run `vdns https install-ca`, restart the browser, and verify with `vdns https status`.

If port `443` is not listening or is owned by another process, `vdns doctor --strict --https` will fail. Stop the conflicting listener or update the service configuration.

If a browser still warns after CA install, quit and reopen the browser. Some browsers cache trust state until restart.
