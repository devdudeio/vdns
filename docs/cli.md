# VNS CLI

The `vns` CLI is the local operator tool behind vDNS. It inspects Verus identities, resolves VNS VDXF keys, and prepares guarded `updateidentity` writes that the vDNS resolver later serves as DNS-compatible records.

Build it first:

```sh
pnpm build
node dist/cli/index.js --help
```

If the package is linked or installed, use the bin name:

```sh
vns --help
```

## RPC Configuration

Command-line flags override environment variables.

| Flag | Env var | Required |
| --- | --- | --- |
| `--rpc-url` | `VERUS_RPC_URL` | required for RPC commands |
| `--rpc-user` | `VERUS_RPC_USER` | optional |
| `--rpc-password` | `VERUS_RPC_PASSWORD` | optional |
| `--rpc-timeout-ms` | `VERUS_RPC_TIMEOUT_MS` | optional, defaults to `10000` |
| `--root` | `VNS_ROOT_IDENTITY` | optional, defaults to `fum@` |
| `--tld` | `VNS_TLD` | optional, defaults to `vrsc` |

No-auth RPC endpoints are supported by omitting user and password.

The HTTP server entrypoint loads `.env` and `.env.local`; shell variables still take precedence. The CLI reads environment variables from the process environment, so export RPC values before running CLI commands or pass the corresponding flags.

## VDXF Keys

Print symbolic key names without RPC:

```sh
node dist/cli/index.js vdxf keys --root dude@ --tld vrsc
```

With RPC configured, the output also includes resolved VDXF IDs:

```sh
VERUS_RPC_URL=http://127.0.0.1:27486 \
node dist/cli/index.js vdxf keys --root dude@ --tld vrsc
```

## Read-Only Examples

Public testnet endpoints are useful for read-only smoke tests. Do not use public endpoints for private write workflows.

```sh
VERUS_RPC_URL=https://api.verustest.net/ \
node dist/cli/index.js identity raw VRSCTEST@
```

Inspect VNS records for a local or configured endpoint:

```sh
VERUS_RPC_URL=http://127.0.0.1:27486 \
node dist/cli/index.js record inspect chainvue.dude@ --root dude@ --tld vrsc
```

Missing identities exit with code `2`.

## Local Fullnode Writes

Prefer a local fullnode for writes. Test `updateidentity` writes on testnet first, with identities and funds you can afford to experiment with.

Example local environment:

```sh
export VERUS_RPC_URL=http://127.0.0.1:27486
export VERUS_RPC_USER=yourrpcuser
export VERUS_RPC_PASSWORD=yourrpcpassword
export VNS_ROOT_IDENTITY=dude@
export VNS_TLD=vrsc
```

Set an A record:

```sh
node dist/cli/index.js record set chainvue.dude@ A @ 192.0.2.10
```

Set a redirect:

```sh
node dist/cli/index.js record set chainvue.dude@ REDIRECT @ https://example.com --status 302 --ttl 300
```

Set a proxy target:

```sh
node dist/cli/index.js record set chainvue.dude@ PROXY @ https://example.com/ --ttl 300
```

Set a SITE record:

```sh
node dist/cli/index.js site build-manifest ./dist/site --base-uri https://cdn.example/site/ --out vdns-site-manifest.json
node dist/cli/index.js site publish ./dist/site chainvue.dude@ --base-uri https://cdn.example/site/ --manifest-uri https://cdn.example/site/vdns-site-manifest.json --yes
```

Set a TLSA fingerprint:

```sh
node dist/cli/index.js record set chainvue.dude@ TLSA @ 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
```

Remove a record:

```sh
node dist/cli/index.js record remove chainvue.dude@ A @
```

Write commands always:

- validate the VNS record before write RPC calls
- fetch the raw identity first
- merge into the existing `contentmultimap`
- preserve unrelated `contentmultimap` keys and unrelated DataDescriptor entries
- submit subidentity updates with the local name plus the parent i-address
- print the exact `updateidentity` payload
- ask `Continue? [y/N]` before calling `updateidentity`

Use `--yes` only after reviewing the command carefully:

```sh
node dist/cli/index.js record set chainvue.dude@ TXT @ "hello=vns" --yes
```

Use `--verify` to refetch and print VNS records after the write:

```sh
node dist/cli/index.js record set chainvue.dude@ A www 192.0.2.11 --yes --verify
```

By default, `--verify` waits until the returned `updateidentity` transaction has one confirmation, then refetches the original CLI target identity. For example, this verifies `google.fum@`, while the submitted update payload may use `name: "google"` plus the `fum@` parent i-address:

```sh
node dist/cli/index.js record set google.fum@ A @ 142.250.181.238 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
```

Confirmation wait options:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--confirmations <n>` | `1` | Required confirmation count before verification |
| `--verify-timeout-ms <ms>` | `180000` | Maximum time to wait for confirmation |
| `--verify-interval-ms <ms>` | `5000` | Poll interval for `getrawtransaction` |
| `--no-wait-confirmation` | disabled | Skip waiting and verify immediately |

`--no-wait-confirmation` preserves immediate refetch behavior and prints a stale-state warning. Immediate mode can show stale `getidentity` state because `updateidentity` returns a transaction id before the identity update is mined and confirmed.

When neither `--root` nor `VNS_ROOT_IDENTITY` is set, write commands warn before using the default `fum@`.

For a subidentity such as `chainvue.fum@`, the preview shows both the user-facing target and the payload target:

```text
Target identity: chainvue.fum@
Update identity name: chainvue
Parent: i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe
Identity address: i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS
```

The following JSON preview then starts with `name: "chainvue"` and the parent i-address. The full target identity is still used for lookup and `--verify` refetches `chainvue.fum@` after confirmation.

VNS DataDescriptor `objectdata` values are written as lowercase hex-encoded UTF-8 JSON. Inline raw JSON objectdata is accepted only for older fixtures and backward compatibility. `objectdata: null` indicates incorrectly encoded or unusable stored data and is skipped with a warning. Decode a stored value manually with:

```sh
echo "<hex>" | xxd -r -p | jq .
```

## Safety Notes

Never commit RPC credentials. Avoid putting passwords directly into shared shell history. Prefer environment variables or a local secrets mechanism.

The CLI never prints RPC passwords. It prints update payloads because payload preview is part of the write safety workflow, so review output for any sensitive record data before sharing logs.

Known limitation: the resolver API parser may still only read the symbolic MVP format unless the resolver is updated to consume DataDescriptor-wrapped real `contentmultimap` records.
