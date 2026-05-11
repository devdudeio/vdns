# Security Notes

vDNS is local-first infrastructure. It is not globally trusted ICANN DNS. Experimental HTTPS support uses a local per-device CA only.

## Local HTTPS CA

`vdns https init-ca` creates a root CA certificate and private key under `$VDNS_STATE_DIR/ca`. The private key is never installed into the macOS keychain by vDNS; only the certificate is trusted by `vdns https install-ca`.

Guardrails:

- generated host certificates are limited to the configured vDNS TLD, default `.vrsc`
- `localhost`, IP literals, non-vDNS domains, ports, paths, whitespace, and suffix tricks are rejected
- CA and certificate cache directories are created with mode `700`
- CA and host private keys are created with mode `600`
- the gateway rejects HTTPS requests where Host and SNI do not match

The CA key is still highly sensitive. Delete trust and local files when you no longer need local HTTPS:

```sh
vdns https uninstall-ca --delete-files
```

Local browser TLS trust is separate from VerusID record verification. Trusting the local CA only lets the browser accept `https://*.vrsc` certificates minted on this machine.

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
