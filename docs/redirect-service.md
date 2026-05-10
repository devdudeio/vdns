# vDNS Local Web Gateway

The local web gateway is the HTTP leg of vDNS for `.vrsc` browser URLs. It is a separate Fastify process that reads the incoming `Host`, asks the VNS resolver API for web records, and either returns a redirect or, when explicitly enabled, proxies the request to an upstream HTTP(S) target.

By default it preserves the original redirect-only behavior. Proxying is opt-in with `VDNS_PROXY_ENABLED=true`.

## REDIRECT Flow

For `chainvue.vrsc`, the identity `chainvue.fum@` can contain:

```text
REDIRECT @ -> http://chainvue.io/
A @ -> 127.0.0.1
```

The `A` record lets local split-DNS resolve `chainvue.vrsc` to `127.0.0.1`. The gateway then handles the HTTP request, asks the resolver for `type=REDIRECT`, and sends the browser to the `REDIRECT` target with `301` or `302`. `REDIRECT` changes the browser URL to the target site and is the more robust browser mode.

## PROXY Flow

For `chainvue.vrsc`, the identity `chainvue.fum@` can also contain:

```text
PROXY @ -> https://chainvue.io/
A @ -> 127.0.0.1
```

When `VDNS_PROXY_ENABLED=true`, the gateway asks the resolver for `type=PROXY` first. If a `PROXY @` record exists, it forwards `GET` and `HEAD` requests to the upstream target and returns the upstream response while keeping the `.vrsc` URL in the browser. If no `PROXY @` record exists, it falls back to the existing `REDIRECT @` behavior. If neither exists, it returns `404`.

V1 follows a small number of upstream redirects server-side, validates every redirect target, and preserves the `.vrsc` browser URL when redirects are valid. `PROXY` is experimental and best-effort: complex sites may break because of CSP, cookies, absolute URLs, auth/OAuth, service workers, WebSockets, CORS, and the lack of HTTPS `.vrsc`.

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
VDNS_PROXY_MAX_REDIRECTS=3
VDNS_PROXY_ALLOW_PRIVATE_TARGETS=false
```

The service loads `.env` and `.env.local`, but it does not require Verus RPC environment variables.

## Guardrails

Proxy targets must use `http://` or `https://`. The gateway rejects same-host and subdomain loops, obvious localhost names, and literal private/internal IP targets including loopback, unspecified, link-local, private IPv4, metadata IP, multicast/reserved IPv4, IPv6 loopback, unique-local, and link-local addresses. It strips hop-by-hop headers and upstream-origin security/session headers that can break local gateway behavior, including CSP, HSTS, X-Frame-Options, and Set-Cookie. It preserves ordinary safe response headers such as Content-Type, Cache-Control, ETag, Last-Modified, Expires, Content-Language, and safe Vary values.

`VDNS_PROXY_ALLOW_PRIVATE_TARGETS=true` disables private/internal target rejection and is unsafe outside advanced local development.

## Limitations

- No HTTPS `.vrsc`, local CA, or TLS interception.
- No browser extension.
- No WebSockets.
- No link rewriting or HTML rewriting.
- No DNS rebinding protection in V1; only literal private/internal IPs and obvious localhost names are blocked.
