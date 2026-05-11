# vDNS

vDNS is a local VerusID-native naming stack. It lets a macOS machine resolve `.vrsc` names from VerusID `contentmultimap` records and route browser requests through local DNS plus a local web gateway.

The code still uses VNS for package names, schemas, internals, and environment variables. The public workflow is vDNS.

## What Works Today?

Current alpha support includes:

- VNS record schema and validation
- configurable root identity and TLD
- mock fixture-backed resolver
- Fastify HTTP resolver API
- separate local Fastify web gateway for `.vrsc` `REDIRECT` records and opt-in `PROXY` records
- read-only Verus JSON-RPC client for `getidentity`, `getinfo`, and `getblockchaininfo`
- redacted debug endpoints for config, raw identity payloads, and RPC health
- local `vns` CLI for VDXF key inspection, raw identity reads, VNS record inspection, and guarded `updateidentity` writes
- CoreDNS plugin MVP that adapts DNS queries to the HTTP resolver
- macOS split-DNS helper scripts for routing `.vrsc` lookups to a local CoreDNS resolver
- `vdns` wrapper commands for setup, install, start, status, doctor, demo, logs, and uninstall
- alpha macOS launchd services for the resolver, CoreDNS, and local web gateway
- experimental opt-in local HTTPS for `https://*.vrsc` with a per-device vDNS root CA

## Quick Install With Homebrew

```sh
brew tap devdudeio/vdns
brew install vdns
vdns setup
vdns install
vdns start
vdns doctor
vdns demo
```

`brew install` installs files only. It does not install launchd services, write `/etc/resolver`, bind port 80, or start background processes. Those steps are explicit through `vdns install` and `vdns start`.

Homebrew configuration lives at `~/.vdns/.env.local`; logs live at `~/.vdns/logs`.

## Quick Demo

After setup and service start:

```sh
vdns status
vdns doctor
vdns demo
curl -i --max-time 10 http://chainvue.vrsc
```

Expected demo records:

```text
google.vrsc    -> A 142.250.181.238
chainvue.vrsc  -> REDIRECT http://chainvue.io/
verus.vrsc     -> PROXY https://verus.io/
```

On macOS, `dig google.vrsc` may not use `/etc/resolver`. Prefer:

```sh
dscacheutil -q host -a name google.vrsc
dig @127.0.0.1 -p 1053 google.vrsc A +short
```

## How It Works

```text
browser/system resolver
  -> /etc/resolver/vrsc
  -> CoreDNS on 127.0.0.1:1053
  -> HTTP resolver on 127.0.0.1:8080
  -> Verus RPC
  -> VerusID contentmultimap records
```

For web requests:

```text
browser -> 127.0.0.1:80 web gateway -> REDIRECT or PROXY record
```

Experimental HTTPS can add:

```text
browser -> 127.0.0.1:443 HTTPS gateway -> REDIRECT or PROXY record
```

See [docs/https.md](docs/https.md) for local CA setup and uninstall steps.

See [docs/architecture.md](docs/architecture.md) for details.

More alpha docs:

- [Homebrew install](docs/homebrew.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security notes](docs/security.md)
- [Alpha release checklist](docs/alpha-release-checklist.md)

## Current Limitations

- public TLS/CA or cross-device trust
- desktop client
- payment/product logic
- real VDXF key registration
- global ICANN DNS trust; vDNS is local-first
- PROXY is experimental and intentionally constrained

## Configuration

| Env var | Default | Description |
| --- | --- | --- |
| `VNS_MODE` | `rpc` | `rpc` or explicit `mock` |
| `VNS_ROOT_IDENTITY` | `fum@` | Root Verus identity namespace |
| `VNS_TLD` | `vrsc` | TLD handled by this resolver |
| `VNS_DEFAULT_TTL` | `300` | Default cache TTL in seconds |
| `PORT` | `8080` | HTTP API port |
| `VERUS_RPC_URL` | `https://api.verustest.net/` | Read/DNS RPC endpoint |
| `VERUS_RPC_USER` | unset | Optional read RPC username |
| `VERUS_RPC_PASSWORD` | unset | Optional read RPC password |
| `VERUS_RPC_TIMEOUT_MS` | `10000` | RPC request timeout in milliseconds |
| `VERUS_WRITE_RPC_URL` | unset | Optional fullnode RPC for record writes |
| `VERUS_WRITE_RPC_USER` | unset | Optional write RPC username |
| `VERUS_WRITE_RPC_PASSWORD` | unset | Optional write RPC password |
| `VERUS_WRITE_RPC_TIMEOUT_MS` | `10000` | Write RPC timeout in milliseconds |

Local redirect service configuration:

| Env var | Default | Description |
| --- | --- | --- |
| `VNS_REDIRECT_HOST` | `127.0.0.1` | Redirect service listen host |
| `VNS_REDIRECT_PORT` | `8081` | Redirect service listen port |
| `VNS_RESOLVER_URL` | `http://127.0.0.1:8080` | Existing VNS HTTP resolver base URL |
| `VNS_TLD` | `vrsc` | TLD handled by this redirect service |
| `VNS_REDIRECT_DEFAULT_STATUS` | `302` | Fallback redirect status when a record status is not `301` or `302` |
| `VNS_REDIRECT_TIMEOUT_MS` | `5000` | Resolver request timeout in milliseconds |
| `VDNS_PROXY_ENABLED` | `false` | Enable `PROXY @` gateway behavior before falling back to `REDIRECT @` |
| `VDNS_PROXY_TIMEOUT_MS` | `10000` | Upstream proxy request timeout in milliseconds |
| `VDNS_PROXY_MAX_BODY_BYTES` | `10485760` | Maximum proxied response body size |
| `VDNS_PROXY_MAX_REDIRECTS` | `3` | Maximum server-side upstream redirects to follow for `PROXY` |
| `VDNS_PROXY_ALLOW_PRIVATE_TARGETS` | `false` | Unsafe advanced local-development escape hatch for private/internal proxy targets |

Experimental local HTTPS configuration:

| Env var | Default | Description |
| --- | --- | --- |
| `VDNS_HTTPS_ENABLED` | `false` | Start the local HTTPS gateway on `127.0.0.1:443` when a local CA exists |
| `VDNS_HTTPS_HOST` | `127.0.0.1` | HTTPS gateway bind host |
| `VDNS_HTTPS_PORT` | `443` | HTTPS gateway bind port |
| `VDNS_TLS_TLD` | `VNS_TLD` or `vrsc` | TLD allowed for generated certificates |
| `VDNS_TLS_CERT_VALIDITY_DAYS` | `397` | Host certificate validity |
| `VDNS_FORCE_HTTPS` | `false` | Experimental HTTP-to-HTTPS redirect for `.vrsc` gateway requests |

## Install And Run

```sh
pnpm install
pnpm test
pnpm build
```

Runtime defaults to RPC mode. `pnpm dev` and `pnpm start` require `VERUS_RPC_URL` from the shell or `.env.local`; use `pnpm dev:mock` for fixture mode.


## Homebrew Alpha

vDNS can be installed from a custom Homebrew tap once a release artifact has been published:

```sh
brew tap devdudeio/vdns
brew install vdns
vdns setup
vdns install
vdns start
vdns status
vdns demo
```

`brew install` only installs files. It does not install launchd services, write `/etc/resolver`, or start background processes. See [docs/homebrew.md](docs/homebrew.md) for release and tap maintenance details.

## Demo

The fastest polished demo is:

```sh
pnpm build
pnpm vdns:up
pnpm vdns:demo
```

`pnpm vdns:demo` is a terminal walkthrough of the complete MVP path:

```text
VerusID records -> HTTP resolver -> CoreDNS -> macOS split-DNS -> local HTTP gateway
```

It verifies:

- the HTTP resolver is running in RPC mode
- `google.vrsc` resolves to `142.250.181.238`
- `chainvue.vrsc` resolves to `127.0.0.1`
- the `chainvue.vrsc` VerusID record contains `REDIRECT -> http://chainvue.io/`
- the `verus.vrsc` VerusID record contains `PROXY -> https://verus.io/`
- `curl -I http://verus.vrsc` returns `x-vdns-proxy: 1` with target host `verus.io`

Expected final output:

```text
vDNS demo passed.
Stop the local stack with: pnpm vdns:down
```

The demo uses these defaults, which can be overridden for another showcase identity:

| Env var | Default |
| --- | --- |
| `VDNS_DEMO_GOOGLE_HOST` | `google.vrsc` |
| `VDNS_DEMO_GOOGLE_A` | `142.250.181.238` |
| `VDNS_DEMO_REDIRECT_HOST` | `chainvue.vrsc` |
| `VDNS_DEMO_REDIRECT_A` | `127.0.0.1` |
| `VDNS_DEMO_REDIRECT_LOCATION` | `http://chainvue.io/` |
| `VDNS_DEMO_PROXY_HOST` | `verus.vrsc` |
| `VDNS_DEMO_PROXY_TARGET_HOST` | `verus.io` |

If the demo fails, run:

```sh
pnpm vdns:status
scripts/macos/diagnose-vdns.sh
```

Stop the demo stack with:

```sh
pnpm vdns:down
```

## macOS Local vDNS Quickstart

This is the polished MVP path for local `.vrsc` resolution on macOS:

```text
VerusID records -> HTTP resolver -> CoreDNS -> macOS split-DNS -> local port 80 redirect
```

Build and run the normal checks first:

```sh
pnpm build
pnpm test
```

Create local configuration and edit the RPC values:

```sh
cp .env.vdns.local.example .env.local
$EDITOR .env.local
```

At minimum, set `VERUS_RPC_URL` and replace `VERUS_RPC_PASSWORD=replace_me` for your local Verus RPC node. `.env.local` is ignored by git.

The demo assumes these records exist under `VNS_ROOT_IDENTITY=fum@` and `VNS_TLD=vrsc`:

```text
google.fum@:   A @ -> 142.250.181.238
chainvue.fum@: A @ -> 127.0.0.1
chainvue.fum@: REDIRECT @ -> http://chainvue.io/ status 302
verus.fum@:    A @ -> 127.0.0.1
verus.fum@:    PROXY @ -> https://verus.io/
```

The `vns` CLI can prepare those writes:

```sh
node dist/cli/index.js record set google.fum@ A @ 142.250.181.238 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set chainvue.fum@ A @ 127.0.0.1 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set chainvue.fum@ REDIRECT @ http://chainvue.io/ --status 302 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set verus.fum@ A @ 127.0.0.1 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set verus.fum@ PROXY @ https://verus.io/ --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
```

Start the local vDNS stack:

```sh
pnpm vdns:up
```

`vdns:up` starts the built HTTP resolver, starts `coredns/coredns-vns` on `127.0.0.1:1053`, installs `/etc/resolver/vrsc` if needed, and starts the built redirect service on `127.0.0.1:80`. It may prompt for `sudo` when installing split-DNS or binding port 80.

Check status and run the demo:

```sh
pnpm vdns:status
pnpm vdns:demo
```

Expected checks:

```sh
dscacheutil -q host -a name google.vrsc
dscacheutil -q host -a name chainvue.vrsc
curl -i --max-time 10 http://chainvue.vrsc
curl -I --max-time 20 http://verus.vrsc
```

`chainvue.vrsc` should return `302` with `Location: http://chainvue.io/`.

Stop local services:

```sh
pnpm vdns:down
```

This stops the resolver, CoreDNS, and port 80 redirect service, while leaving `/etc/resolver/vrsc` installed.

`pnpm vdns:up` and `pnpm vdns:down` are dev-process scripts. They start background processes from the current checkout and stop those PID-file-managed processes.

For alpha launchd service mode:

```sh
pnpm build
cp .env.vdns.local.example .env.local
# edit .env.local
pnpm vdns:install
pnpm vdns:start
pnpm vdns:service-status
pnpm vdns:demo
pnpm vdns:stop
pnpm vdns:uninstall
```

`pnpm vdns:install`, `pnpm vdns:start`, `pnpm vdns:stop`, and `pnpm vdns:uninstall` install and manage launchd jobs. The HTTP resolver and CoreDNS run as user LaunchAgents. The browser-style redirect service runs as a root LaunchDaemon because `http://chainvue.vrsc` requires binding privileged port `80`. HTTPS, local TLS, and local CA support remain future work.

See [docs/macos-services.md](docs/macos-services.md) for installed plist paths, logs, troubleshooting, uninstall options, and alpha limitations.

Manual fallback commands:

```sh
pnpm build
node dist/index.js
cd coredns && ./run-local-resolver.sh
sudo scripts/macos/install-vrsc-resolver.sh
sudo scripts/macos/start-redirect-port80.sh
scripts/macos/diagnose-vdns.sh
scripts/macos/test-chainvue-redirect.sh
sudo scripts/macos/stop-redirect-port80.sh
```

See [docs/mvp-checkpoint.md](docs/mvp-checkpoint.md) for the checkpoint details.

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

Run the local web gateway in a second terminal:

```sh
VDNS_PROXY_ENABLED=true VNS_RESOLVER_URL=http://127.0.0.1:8080 VNS_REDIRECT_PORT=8081 pnpm redirect:dev
```

For the local gateway demo, `chainvue.fum@` should contain `A @ -> 127.0.0.1` and `REDIRECT @ -> http://chainvue.io/`; `verus.fum@` should contain `A @ -> 127.0.0.1` and `PROXY @ -> https://verus.io/`. With `VDNS_PROXY_ENABLED=true`, PROXY records are served before REDIRECT fallback. Then test:

```sh
curl http://127.0.0.1:8081/health
curl "http://127.0.0.1:8081/debug/resolve?host=chainvue.vrsc"
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
```

By default the web gateway only returns HTTP redirects. `REDIRECT` changes the browser URL to the target site and is the more robust mode. With `VDNS_PROXY_ENABLED=true`, `PROXY @` records are proxied before falling back to `REDIRECT @`; `PROXY` keeps the `.vrsc` URL in the browser, supports only `GET` and `HEAD` in V1, and is experimental/best-effort. Proxying forwards paths and queries, follows a small number of validated upstream redirects server-side, strips hop-by-hop and problematic browser-security/session headers, rejects same-host loops and explicit localhost/private targets, and does not expose resolver/RPC credentials. Complex sites may still break because of CSP, cookies, absolute URLs, auth/OAuth, service workers, WebSockets, CORS, and the lack of HTTPS `.vrsc`. `VDNS_PROXY_ALLOW_PRIVATE_TARGETS=true` is unsafe and only for advanced local development. DNS rebinding protection is not implemented in V1; literal private/internal IPs and obvious localhost names are blocked.

For normal local HTTP on macOS:

```sh
pnpm build
sudo scripts/macos/start-redirect-port80.sh
curl -i --max-time 10 http://chainvue.vrsc
```

Stop the port 80 redirect service with:

```sh
sudo scripts/macos/stop-redirect-port80.sh
```

Diagnose the full VNS/CoreDNS/macOS resolver/redirect path:

```sh
scripts/macos/diagnose-vdns.sh
scripts/macos/test-chainvue-redirect.sh
```

See [docs/redirect-service.md](docs/redirect-service.md) for the complete redirect service flow and limitations.

Run against a read-only public Verus testnet RPC endpoint:

```sh
VNS_MODE=rpc VERUS_RPC_URL=https://api.verustest.net/ pnpm dev
```

The public endpoint is an example only. Do not put credentials in URLs you share. `fum@` may not exist on testnet yet, so `VRSCTEST@` is a better smoke-test identity.

## Running HTTP Resolver In RPC Mode

Create `.env.local`. Runtime DNS can use the default public read RPC; record writes need your own fullnode RPC:

```dotenv
VNS_MODE=rpc
VNS_ROOT_IDENTITY=fum@
VNS_TLD=vrsc
VERUS_RPC_URL=https://api.verustest.net/
VERUS_WRITE_RPC_URL=http://192.168.0.106:18843
VERUS_WRITE_RPC_USER=user972661718
VERUS_WRITE_RPC_PASSWORD=your_password
VERUS_RPC_TIMEOUT_MS=10000
VERUS_WRITE_RPC_TIMEOUT_MS=10000
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
?type=PROXY
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

## CoreDNS Plugin MVP

The CoreDNS plugin is a thin DNS adapter. It receives DNS queries, calls the existing VNS HTTP resolver, and converts normalized VNS records into DNS answers. It does not talk to Verus RPC directly.

Supported DNS record types in this MVP:

- `A`
- `AAAA`
- `CNAME`
- `TXT`

`REDIRECT` records are not DNS records and are not returned by the plugin. `TLSA` is reserved for a later step.

Manual flow:

1. Start the VNS HTTP resolver in RPC mode:

```sh
VNS_MODE=rpc \
VNS_ROOT_IDENTITY=fum@ \
VNS_TLD=vrsc \
VERUS_RPC_URL=http://192.168.0.106:18843 \
VERUS_RPC_USER=... \
VERUS_RPC_PASSWORD=... \
pnpm dev
```

2. Verify the HTTP resolver:

```sh
curl http://127.0.0.1:8080/resolve-domain/google.vrsc | jq .
```

3. Build a custom CoreDNS binary with the VNS plugin:

```sh
cd coredns
./build-coredns.sh
```

The build script clones pinned CoreDNS source, injects the local `vns` plugin into `plugin.cfg`, adds a local Go `replace`, and writes `coredns/coredns-vns`.

4. Run CoreDNS in `.vrsc`-only mode:

```sh
./run-vrsc-only.sh
```

5. Query it directly:

```sh
dig @127.0.0.1 -p 1053 google.vrsc A
```

Expected answer:

```text
google.vrsc. 300 IN A 142.250.181.238
```

For a name that currently has only a VNS `REDIRECT` record:

```sh
dig @127.0.0.1 -p 1053 chainvue.vrsc A
```

That should return `NOERROR` with no answers, because `REDIRECT` is not an `A` record.

In `.vrsc`-only mode, normal DNS names are not forwarded:

```sh
dig @127.0.0.1 -p 1053 google.com A
```

This may return `REFUSED` or no useful answer, depending on the CoreDNS response path. That is expected for isolated plugin testing.

## CoreDNS Local Resolver Mode

Local resolver mode handles `.vrsc` through VNS and forwards every other DNS name to normal upstream resolvers.

Run it after building `coredns-vns`:

```sh
cd coredns
./run-local-resolver.sh
```

Test `.vrsc`:

```sh
dig @127.0.0.1 -p 1053 google.vrsc A +short
```

Expected:

```text
142.250.181.238
```

Test normal DNS forwarding:

```sh
dig @127.0.0.1 -p 1053 google.com A +short
```

Expected: one or more public Google `A` records from upstream DNS.

You can run both checks with:

```sh
./test-local-resolver.sh
```

CoreDNS configuration files:

- [coredns/Corefile.vrsc-only.example](coredns/Corefile.vrsc-only.example): `.vrsc` only on port `1053`.
- [coredns/Corefile.local-resolver.example](coredns/Corefile.local-resolver.example): `.vrsc` via VNS plus public DNS forwarding on port `1053`.
- [coredns/Corefile.local-resolver-53.example](coredns/Corefile.local-resolver-53.example): same as local resolver mode, but on port `53`.
- [coredns/Corefile.local-resolver.env.example](coredns/Corefile.local-resolver.env.example): same localhost-bound pattern with CoreDNS environment variable substitution.

Port `53` usually requires elevated privileges/admin/root and may conflict with the operating system DNS service. This repo does not install or configure system-wide DNS.

Docker Desktop users can set `resolver_url http://host.docker.internal:8080`; local non-Docker runs should use `http://127.0.0.1:8080`.

## macOS Split-DNS Setup For `.vrsc`

macOS can route only `.vrsc` lookups to the local CoreDNS/VNS resolver with `/etc/resolver/vrsc`. Normal DNS names stay on the system resolver path.

Start the VNS HTTP resolver in RPC mode:

```sh
VNS_MODE=rpc \
VNS_ROOT_IDENTITY=fum@ \
VNS_TLD=vrsc \
VERUS_RPC_URL=http://192.168.0.106:18843 \
VERUS_RPC_USER=... \
VERUS_RPC_PASSWORD=... \
pnpm dev
```

Start CoreDNS local resolver mode in another terminal:

```sh
cd coredns
./build-coredns.sh
./run-local-resolver.sh
```

The local resolver Corefile binds CoreDNS to `127.0.0.1:1053`. From the repo root, install the macOS split-DNS resolver file:

```sh
sudo scripts/macos/install-vrsc-resolver.sh
```

Equivalent package scripts are available:

```sh
pnpm macos:resolver:install
pnpm macos:resolver:status
pnpm macos:resolver:uninstall
```

Verify split-DNS routing:

```sh
scutil --dns | grep -A5 'domain   : vrsc'
dig google.vrsc A +short
dig google.com A +short
```

Some command-line DNS tools may bypass macOS split-DNS behavior. For `.vrsc`, prefer:

```sh
dscacheutil -q host -a name google.vrsc
dns-sd -G v4 google.vrsc
dig @127.0.0.1 -p 1053 google.vrsc A +short
```

## Making `http://*.vrsc` Work On macOS

macOS split-DNS and CoreDNS make `chainvue.vrsc` resolve to `127.0.0.1`. A normal URL like `http://chainvue.vrsc` then connects to port `80`, not port `8081`.

If the redirect service is running on `8081`, this Host-header test can pass:

```sh
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
```

while this still fails because no redirect service is listening on `127.0.0.1:80`:

```sh
curl -i --max-time 10 http://chainvue.vrsc
```

Start the built redirect service directly on port `80`:

```sh
pnpm build
sudo scripts/macos/start-redirect-port80.sh
```

Stop it:

```sh
sudo scripts/macos/stop-redirect-port80.sh
```

Diagnose and test:

```sh
scripts/macos/diagnose-vdns.sh
scripts/macos/test-chainvue-redirect.sh
```

Uninstall the managed resolver file:

```sh
sudo scripts/macos/uninstall-vrsc-resolver.sh
```

Troubleshooting:

- Confirm CoreDNS is listening on `127.0.0.1:1053` with `scripts/macos/status-vrsc-resolver.sh`.
- Confirm `/etc/resolver/vrsc` exists and contains `nameserver 127.0.0.1` and `port 1053`.
- Confirm `scutil --dns` shows a `vrsc` resolver.
- Confirm the VNS HTTP resolver is running at `http://127.0.0.1:8080`.
- Do not edit `/etc/resolv.conf`; macOS manages that file.

Plugin tests:

```sh
cd coredns/plugin/vns
CGO_ENABLED=0 go test ./...
```

Limitations:

- This is not system-wide DNS.
- Use `dscacheutil`, `dns-sd`, or direct `dig @127.0.0.1 -p 1053` checks for `.vrsc` resolver diagnostics.
- Browser HTTPS and `.vrsc` local CA support are not part of this step.
- Production deployment later needs local resolver setup, caching policy, rate limits, and likely DoH/DoT.
