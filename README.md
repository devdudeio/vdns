# VNS

VNS is a VerusID-native naming layer. It maps `.vrsc` domains to Verus sub-identities and reads DNS/web records from VerusID `contentmultimap` data using a VDXF-based record schema.

This repository currently contains the Step 3 MVP foundation: schema, fixtures, resolver core, mock-backed HTTP API, read-only Verus JSON-RPC mode, and a guarded local `vns` CLI for inspecting and preparing VerusID `contentmultimap` updates.

## Scope

Implemented now:

- VNS record schema and validation
- configurable root identity and TLD
- mock fixture-backed resolver
- Fastify HTTP resolver API
- read-only Verus JSON-RPC client for `getidentity`, `getinfo`, and `getblockchaininfo`
- redacted debug endpoints for config, raw identity payloads, and RPC health
- local `vns` CLI for VDXF key inspection, raw identity reads, VNS record inspection, and guarded `updateidentity` writes

Not implemented yet:

- CoreDNS plugin
- real local DNS server
- local redirect service
- local TLS/CA
- desktop client
- payment/product logic
- real VDXF key registration

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `VNS_MODE` | `rpc` | `rpc` or explicit `mock` |
| `VNS_ROOT_IDENTITY` | `fum@` | Root Verus identity namespace |
| `VNS_TLD` | `vrsc` | TLD handled by this resolver |
| `VNS_DEFAULT_TTL` | `300` | Default cache TTL in seconds |
| `PORT` | `8080` | HTTP API port |
| `VERUS_RPC_URL` | unset | Required only in `rpc` mode |
| `VERUS_RPC_USER` | unset | Optional RPC username |
| `VERUS_RPC_PASSWORD` | unset | Optional RPC password |
| `VERUS_RPC_TIMEOUT_MS` | `10000` | RPC request timeout in milliseconds |

## Install And Run

```sh
pnpm install
pnpm test
pnpm build
```

Runtime defaults to RPC mode. `pnpm dev` and `pnpm start` require `VERUS_RPC_URL` from the shell or `.env.local`; use `pnpm dev:mock` for fixture mode.

After `pnpm build`, the CLI entrypoint is available at:

```sh
node dist/cli/index.js --help
node dist/cli/index.js vdxf keys --root dude@ --tld vrsc
```

When linked or installed as a package, the bin name is `vns`:

```sh
vns --help
vns record inspect chainvue.dude@
```

With RPC configuration loaded, check the server in another terminal:

```sh
curl http://localhost:8080/health
curl http://localhost:8080/resolve-domain/myname.vrsc
curl "http://localhost:8080/resolve-domain/www.myname.vrsc?type=CNAME"
```

Use a custom root identity:

```sh
VNS_ROOT_IDENTITY=VERUSNAMESERVICE@ pnpm dev
curl http://localhost:8080/resolve-domain/myname.vrsc
```

The response identity will be `myname.VERUSNAMESERVICE@`.

Run against a read-only public Verus testnet RPC endpoint:

```sh
VNS_MODE=rpc VERUS_RPC_URL=https://api.verustest.net/ pnpm dev
```

The public endpoint is an example only. Do not put credentials in URLs you share. `fum@` may not exist on testnet yet, so `VRSCTEST@` is a better smoke-test identity.

## Running HTTP Resolver In RPC Mode

Create `.env.local` for a local Verus RPC node:

```dotenv
VNS_MODE=rpc
VNS_ROOT_IDENTITY=fum@
VNS_TLD=vrsc
VERUS_RPC_URL=http://192.168.0.106:18843
VERUS_RPC_USER=user972661718
VERUS_RPC_PASSWORD=your_password
VERUS_RPC_TIMEOUT_MS=10000
```

Start the dev server:

```sh
pnpm dev
```

or:

```sh
pnpm dev:rpc
```

Check the running mode and VDXF IDs:

```sh
curl http://127.0.0.1:8080/debug/config | jq .
curl http://127.0.0.1:8080/debug/vdxf-keys | jq .
curl http://127.0.0.1:8080/debug/raw-identity/google.fum@ | jq '.identity.contentmultimap'
curl http://127.0.0.1:8080/resolve-domain/google.vrsc | jq .
```

If `/debug/config` shows `"mode": "mock"`, the server was started with `pnpm dev:mock` or `VNS_MODE=mock` is set in the shell. Check with `echo $VNS_MODE` and clear it with `unset VNS_MODE`. In RPC mode with `VNS_ROOT_IDENTITY=fum@` and `VNS_TLD=vrsc`, `google.vrsc` maps to `google.fum@`. Real Verus records are stored as DataDescriptor entries whose `objectdata` is hex-encoded JSON; the HTTP resolver parses the same shape as `vns record inspect`.

If `/debug/config` shows `"rpcUrlConfigured": false`, `VERUS_RPC_URL` is missing. Check `.env.local` and shell environment variables.

## Running HTTP Resolver In Mock Mode

Mock mode uses local fixtures and does not read Verus chain data:

```sh
pnpm dev:mock
```

or:

```sh
VNS_MODE=mock pnpm dev
```

## CLI Quick Start

The CLI uses the same RPC environment variables as the API, and command-line flags override env vars:

```sh
export VERUS_RPC_URL=http://127.0.0.1:27486
export VERUS_RPC_USER=yourrpcuser
export VERUS_RPC_PASSWORD=yourrpcpassword

node dist/cli/index.js identity raw chainvue.dude@
node dist/cli/index.js record inspect chainvue.dude@ --root dude@ --tld vrsc
node dist/cli/index.js record set chainvue.dude@ A @ 192.0.2.10 --root dude@ --yes --verify
node dist/cli/index.js record remove chainvue.dude@ A @ --root dude@ --yes --verify
node dist/cli/index.js record set google.fum@ A @ 142.250.181.238 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
```

Write commands always fetch the current raw identity first, merge into the existing `contentmultimap`, print the exact `updateidentity` payload, and ask `Continue? [y/N]` unless `--yes` is supplied. For subidentities, the submitted payload uses the local identity name plus the parent identity i-address, for example `chainvue.fum@` is submitted as `name: "chainvue"` with `parent: "<fum i-address>"`. Test writes on testnet first and prefer a local fullnode for writes. Never commit RPC credentials or put them in shared shell history.

With `--verify`, write commands wait for the returned `updateidentity` transaction to reach one confirmation before refetching records. Tune this with `--confirmations`, `--verify-timeout-ms`, and `--verify-interval-ms`. Use `--no-wait-confirmation` to refetch immediately; this can show stale `getidentity` state because `updateidentity` returns a transaction id before the update is mined and confirmed.

See [docs/cli.md](docs/cli.md) for complete CLI examples and safety notes.

## API

```http
GET /health
GET /debug/config
GET /debug/rpc-health
GET /debug/vdxf-keys
GET /debug/raw-identity/:identity
GET /resolve/:identity
GET /resolve-domain/:domain
```

Both resolver routes support:

```http
?type=A
?type=AAAA
?type=CNAME
?type=TXT
?type=REDIRECT
?type=TLSA
```

Debug examples:

```sh
curl http://localhost:8080/debug/config
curl http://localhost:8080/debug/rpc-health
curl http://localhost:8080/debug/raw-identity/VRSCTEST@
curl http://localhost:8080/resolve/VRSCTEST@
```

`/debug/config` reports only safe RPC details such as whether a URL/auth is configured and the parseable URL host. It never returns credentials or the full RPC URL.

Missing identities return `404` from `/resolve/:identity`, `/resolve-domain/:domain`, and `/debug/raw-identity/:identity`. Existing identities without `VNS.vrsc::record` return `records: []` with parser warnings.

Example response:

```json
{
  "identity": "myname.fum@",
  "domain": "www.myname.vrsc",
  "host": "www",
  "records": [],
  "warnings": []
}
```

## Domain Mapping

With `VNS_ROOT_IDENTITY=fum@` and `VNS_TLD=vrsc`:

- `myname.vrsc` -> `myname.fum@`, host `@`
- `www.myname.vrsc` -> `myname.fum@`, host `www`
- `api.myname.vrsc` -> `myname.fum@`, host `api`

With `VNS_ROOT_IDENTITY=VERUSNAMESERVICE@`:

- `myname.vrsc` -> `myname.VERUSNAMESERVICE@`, host `@`

VNS Step 2 rejects deep domains such as `a.b.myname.vrsc`.

## Integration Tests

Normal tests do not make network calls. To run the skipped Verus RPC integration tests:

```sh
RUN_RPC_INTEGRATION_TESTS=1 VERUS_RPC_URL=https://api.verustest.net/ pnpm test
```

## Verus Record Notes

The CLI writes DataDescriptor-wrapped JSON records under resolved VDXF IDs and preserves unrelated `contentmultimap` entries. DataDescriptor `objectdata` is stored as lowercase hex-encoded UTF-8 JSON, not as an inline JSON object. Inline objectdata objects are accepted only for old fixtures and backward compatibility.

If a stored DataDescriptor has `objectdata: null`, the value is incorrectly encoded or unusable and is skipped with a warning. To inspect a hex payload manually:

```sh
echo "<hex>" | xxd -r -p | jq .
```

## Suggested Next Ticket

Adapt resolver reads to consume DataDescriptor-wrapped real VDXF `contentmultimap` records end to end.
