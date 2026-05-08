# vDNS Local Redirect Service

The local redirect service is the HTTP leg of vDNS for `.vrsc` web redirects. It is a separate Fastify process that reads the incoming `Host`, asks the VNS resolver API for `REDIRECT` records, and returns only HTTP redirects.

It does not proxy, fetch target content, rewrite HTML, follow redirects, or use Verus RPC credentials.

## Flow

For `chainvue.vrsc`, the identity `chainvue.fum@` should contain:

```text
REDIRECT @ -> http://chainvue.io/
A @ -> 127.0.0.1
```

The `A` record lets local split-DNS resolve `chainvue.vrsc` to `127.0.0.1`. The redirect service then handles the HTTP request and sends the browser to the `REDIRECT` target.

## Run

Start the resolver API first:

```sh
pnpm dev
```

or, after building:

```sh
node dist/index.js
```

Start the redirect service in another terminal:

```sh
VNS_RESOLVER_URL=http://127.0.0.1:8080 VNS_REDIRECT_PORT=8081 pnpm redirect:dev
```

## Test

```sh
curl http://127.0.0.1:8081/health
curl "http://127.0.0.1:8081/debug/resolve?host=chainvue.vrsc"
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
```

The redirect service listens on `127.0.0.1:8081` by default. Browser use without a port requires listening on port 80 or a later local forwarding or LaunchDaemon setup.

## Making `http://*.vrsc` Work On macOS

`.vrsc` names resolve to `127.0.0.1` through macOS split-DNS and the local CoreDNS VNS plugin. Normal HTTP URLs use port `80`, so this works only when something is listening on `127.0.0.1:80`.

If the redirect service is running only on `8081`, Host-header tests can pass:

```sh
curl -i -H "Host: chainvue.vrsc" http://127.0.0.1:8081/
```

but normal URL tests can still fail or hang:

```sh
curl -i http://chainvue.vrsc
```

For normal local HTTP, build first and start the redirect service directly on port `80`:

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
```

The service loads `.env` and `.env.local`, but it does not require Verus RPC environment variables.

## Limitations

- No HTTPS or local CA setup yet.
- Port 80 can be run manually with `sudo scripts/macos/start-redirect-port80.sh`; no LaunchDaemon installer exists yet.
- Redirect-only behavior; no proxying or content fetching.
- Browser use without a port requires port 80 or a later local forwarding/LaunchDaemon setup.
