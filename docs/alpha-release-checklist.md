# Alpha Release Checklist

Run before tagging or publishing a Homebrew artifact:

- `pnpm build`
- `pnpm test`
- `vdns doctor`
- `vdns doctor --strict`
- `vdns demo`
- reboot test
- Homebrew uninstall/reinstall test
- second-machine test
- docs reviewed
- release artifact generated with `scripts/release/build-homebrew-artifact.sh`
- tap formula updated in `devdudeio/homebrew-vdns`

Homebrew smoke test:

```sh
brew update
brew tap devdudeio/vdns
brew install vdns
vdns setup
vdns install
vdns start
vdns doctor
vdns demo
vdns uninstall
brew uninstall vdns
```

