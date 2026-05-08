# VNS Step 2 Architecture

VNS Step 2 is a small resolver foundation:

```text
HTTP client
  -> Fastify HTTP API
  -> VNS resolver core
  -> Verus RPC-like interface
  -> mock fixture client or read-only Verus JSON-RPC client
```

The resolver core owns domain parsing, record parsing, validation, filtering, and caching. Verus identity access is isolated behind `VerusRpcLike`, so tests and local development use fixtures without requiring a real Verus node. RPC mode uses JSON-RPC POST requests with optional Basic Auth and request timeouts.

## Namespace Configuration

The root identity and TLD are runtime configuration:

- `VNS_ROOT_IDENTITY`, default `fum@`
- `VNS_TLD`, default `vrsc`

For example, `myname.vrsc` resolves to `myname.fum@` by default, but with `VNS_ROOT_IDENTITY=VERUSNAMESERVICE@` it resolves to `myname.VERUSNAMESERVICE@`.

## Mock Vs RPC Mode

`VNS_MODE=rpc` is the default. RPC mode requires `VERUS_RPC_URL`; startup fails fast if the URL is missing. `VNS_MODE=mock` must be requested explicitly and reads JSON fixtures from `fixtures/identities` instead of Verus chain data.

For a read-only public Verus testnet endpoint:

```sh
VNS_MODE=rpc VERUS_RPC_URL=https://api.verustest.net/ pnpm dev
```

For a local fullnode resolving the `fum@` namespace, create `.env.local`:

```dotenv
VNS_MODE=rpc
VNS_ROOT_IDENTITY=fum@
VNS_TLD=vrsc
VERUS_RPC_URL=http://192.168.0.106:18843
VERUS_RPC_USER=user972661718
VERUS_RPC_PASSWORD=your_password
VERUS_RPC_TIMEOUT_MS=10000
```

Then start:

```sh
pnpm dev
```

or:

```sh
pnpm dev:rpc
```

Mock mode remains available for fixture development:

```sh
pnpm dev:mock
```

The RPC client calls `getidentity`, adapts `result.identity.name` and `result.identity.contentmultimap` into the internal payload shape, and returns `null` for Verus JSON-RPC `-5` missing-identity responses. Upstream HTTP/RPC/network failures map to gateway errors at the API boundary, while timeouts map to `504`.

In RPC mode the resolver derives VNS VDXF key names from `VNS_ROOT_IDENTITY` and `VNS_TLD`, resolves them with `getvdxfid`, and caches the resolved IDs in memory. Those IDs are used to parse real Verus `contentmultimap` entries under keys such as `fum.vrsc::vns.record`. DataDescriptor `objectdata` is hex-encoded JSON and is decoded by the shared parser used by both HTTP resolution and CLI record inspection.

Useful checks:

```sh
curl http://127.0.0.1:8080/debug/config | jq .
curl http://127.0.0.1:8080/debug/vdxf-keys | jq .
curl http://127.0.0.1:8080/debug/raw-identity/google.fum@ | jq '.identity.contentmultimap'
curl http://127.0.0.1:8080/resolve-domain/google.vrsc | jq .
```

If `/debug/config` shows `"mode": "mock"`, the process was started with `pnpm dev:mock` or `VNS_MODE=mock` is set in the shell. Check `echo $VNS_MODE` and run `unset VNS_MODE` before starting RPC mode. If `/debug/config` shows `"rpcUrlConfigured": false`, `VERUS_RPC_URL` is missing from `.env.local` and the shell environment. With `VNS_ROOT_IDENTITY=fum@` and `VNS_TLD=vrsc`, `google.vrsc` maps to `google.fum@`.

Debug routes share this boundary:

- `/debug/config` returns redacted runtime configuration only.
- `/debug/raw-identity/:identity` returns the fixture payload or raw RPC `getidentity` result.
- `/debug/rpc-health` returns mock health in mock mode, or `getinfo`/`getblockchaininfo` data in RPC mode.
- `/debug/vdxf-keys` returns VNS key names and the resolved or placeholder VDXF IDs.

## Current Scope

Step 2 includes:

- normalized VNS record schema
- mock Verus identity fixtures
- resolver core library
- Fastify resolver API
- read-only Verus JSON-RPC client
- safe debug endpoints

Future milestones include:

- CoreDNS plugin
- real local DNS server
- local redirect service
- local TLS/CA
- desktop client
- real VDXF key registration, publishing, and mapping adapters
