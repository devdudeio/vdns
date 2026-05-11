# Security Notes

vDNS is local-first infrastructure. It is not globally trusted ICANN DNS, and it does not currently provide HTTPS or a local CA.

## PROXY

`PROXY` is experimental and powerful. When enabled, the local web gateway fetches upstream content on behalf of a `.vrsc` hostname.

Default protections:

- localhost, private, link-local, multicast, and internal literal targets are blocked
- selected hop-by-hop and sensitive upstream headers are stripped
- selected browser security headers from upstream responses are stripped where they do not apply cleanly to the local hostname
- response body size and redirect count are bounded
- private targets require an explicit unsafe local-development override

The gateway supports GET and HEAD only. It is intended for local alpha testing, not production hosting.

## Secrets

`VERUS_RPC_PASSWORD` belongs in the local env file, not in docs, scripts, or issue reports. `vdns doctor` reports whether RPC auth is configured but does not print the password or Basic Auth header.

Homebrew config is stored at:

```text
~/.vdns/.env.local
```

Recommended permissions:

```sh
chmod 600 ~/.vdns/.env.local
```

## Namespace Policy

Namespace abuse, trademark disputes, and identity naming policy are separate from this local resolver implementation. vDNS resolves records from the configured Verus root identity and TLD; it does not decide global naming policy.

