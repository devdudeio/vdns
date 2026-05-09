# vDNS Local Web Gateway

The local web gateway is the HTTP leg of vDNS for `.vrsc` browser URLs. It is a separate Fastify process that reads the incoming `Host`, asks the VNS resolver API for web records, and either returns a redirect or, when explicitly enabled, proxies the request to an upstream HTTP(S) target.

By default it preserves the original redirect-only behavior. Proxying is opt-in with `VDNS_PROXY_ENABLED=true`.

## REDIRECT Flow

For `chainvue.vrsc`, the identity `chainvue.fum@` can contain:

```text
REDIRECT @ -> http://chainvue.io/
A @ -> 127.0.0.1
```

The `A` record lets local split-DNS resolve `chainvue.vrsc` to `127.0.0.1`. The gateway then handles the HTTP request, asks the resolver for `type=REDIRECT`, and sends the browser to the `REDIRECT` target with `301` or `302`.

## PROXY Flow

For `verus.vrsc`, the identity `verus.fum@` can contain:

```text
PROXY @ -> https://verus.io/
A @ -> 127.0.0.1
```

When `VDNS_PROXY_ENABLED=true`, the gateway asks the resolver for `type=PROXY` first. If a `PROXY @` record exists, it forwards the incoming path and query to the upstream target and returns the upstream response. If no `PROXY @` record exists, it falls back to the existing `REDIRECT @` behavior. If neither exists, it returns `404`.

V1 redirect handling for proxied upstream responses is manual only. If the upstream returns `301` or `302`, the gateway passes that response through, so the browser may leave `.vrsc` and navigate to the upstream domain.

## Run

Start the resolver API first:

```sh
pnpm dev
```

or, after building:

```sh
node dist/index.js
```

Start the gateway in another terminal:

```sh
VNS_RESOLVER_URL=http://127.0.0.1:8080 VNS_REDIRECT_PORT=8081 pnpm redirect:dev
```

Enable proxying explicitly:

```sh
VDNS_PROXY_ENABLED=true VNS_RESOLVER_URL=http://127.0.0.1:8080 VNS_REDIRECT_PORT=8081 pnpm redirect:dev
```

## Test

```sh
curl http://127.0.0.1:8081/health
curl "http://127.0.0.1:8081/debug/resolve?host=chainvue.vrsc"
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
curl -i -H "Host: verus.vrsc" http://127.0.0.1:8081/docs?x=1
```

The gateway listens on `127.0.0.1:8081` by default. Browser use without a port requires listening on port 80 or using the macOS service scripts.

## Making `http://*.vrsc` Work On macOS

`.vrsc` names resolve to `127.0.0.1` through macOS split-DNS and the local CoreDNS VNS plugin. Normal HTTP URLs use port `80`, so this works only when something is listening on `127.0.0.1:80`.

If the gateway is running only on `8081`, Host-header tests can pass:

```sh
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
```

but normal URL tests can still fail or hang:

```sh
curl -i http://chainvue.vrsc
```

For normal local HTTP, build first and start the gateway directly on port `80`:

```sh
pnpm build
sudo scripts/macos/start-redirect-port80.sh
```

Stop it with:

```sh
sudo scripts/macos/stop-redirect-port80.sh
```

Diagnose the full local path:

```sh
scripts/macos/diagnose-vdns.sh
```

Run the focused chainvue test:

```sh
scripts/macos/test-chainvue-redirect.sh
```

`dig google.vrsc` may not use macOS split-DNS in the same way as normal system lookups. Prefer one of these checks:

```sh
dscacheutil -q host -a name google.vrsc
dns-sd -G v4 google.vrsc
dig @127.0.0.1 -p 1053 google.vrsc A +short
```

## Configuration

```dotenv
VNS_REDIRECT_HOST=127.0.0.1
VNS_REDIRECT_PORT=8081
VNS_RESOLVER_URL=http://127.0.0.1:8080
VNS_TLD=vrsc
VNS_REDIRECT_DEFAULT_STATUS=302
VNS_REDIRECT_TIMEOUT_MS=5000
VDNS_PROXY_ENABLED=false
VDNS_PROXY_TIMEOUT_MS=10000
VDNS_PROXY_MAX_BODY_BYTES=10485760
VDNS_PROXY_FOLLOW_REDIRECTS=manual
```

The service loads `.env` and `.env.local`, but it does not require Verus RPC environment variables.

## Guardrails

Proxy targets must use `http://` or `https://`. The gateway rejects same-host loops and explicit localhost or private IP targets. It strips hop-by-hop headers and response headers that can break local gateway behavior, including CSP, HSTS, X-Frame-Options, and Set-Cookie. It preserves ordinary safe response headers such as Content-Type, Cache-Control, ETag, Last-Modified, and Location.

## Limitations

- No HTTPS `.vrsc`, local CA, or TLS interception.
- No browser extension.
- No WebSockets.
- No link rewriting or HTML rewriting.
- Proxy redirect policy is manual only; limited upstream redirect following is reserved for a later version.
