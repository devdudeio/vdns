# vDNS MVP Checkpoint

vDNS turns VerusID identities into locally resolvable DNS records. Some internal schemas and compatibility commands still use VNS terminology, but the user-facing path is vDNS: a VerusID-native, DNS-compatible local resolver.

## Confirmed Path

```text
VerusID contentmultimap records
  -> vDNS HTTP resolver
  -> CoreDNS vns plugin on 127.0.0.1:1053
  -> macOS /etc/resolver/vrsc split-DNS
  -> local HTTP redirect service on 127.0.0.1:80
```

The checkpoint uses `.vrsc` as the local TLD and `fum@` as the default VerusID root namespace. With `VNS_ROOT_IDENTITY=fum@`, `google.vrsc` maps to `google.fum@`, and `chainvue.vrsc` maps to `chainvue.fum@`.

## Verified Records

`google.fum@`:

```text
A @ -> 142.250.181.238
```

Expected local result:

```sh
dscacheutil -q host -a name google.vrsc
```

`chainvue.fum@`:

```text
A @ -> 127.0.0.1
REDIRECT @ -> http://chainvue.io/ status 302
```

Expected local result:

```sh
dscacheutil -q host -a name chainvue.vrsc
curl -i --max-time 10 http://chainvue.vrsc
```

The HTTP response should be `302` with:

```text
Location: http://chainvue.io/
```

## Operator Commands

Prepare local configuration:

```sh
cp .env.vdns.local.example .env.local
$EDITOR .env.local
```

Set `VERUS_RPC_URL`, `VERUS_RPC_USER`, and `VERUS_RPC_PASSWORD` for the local Verus RPC node. Do not commit `.env.local`.

Build and test:

```sh
pnpm build
pnpm test
```

Start the local stack:

```sh
pnpm vdns:up
```

Check status and run the demo:

```sh
pnpm vdns:status
pnpm vdns:demo
```

Stop local services:

```sh
pnpm vdns:down
```

`vdns:down` stops the resolver, CoreDNS, and port 80 redirect service. It leaves `/etc/resolver/vrsc` installed so the next `vdns:up` does not need to reinstall split-DNS.

## CLI Record Writes

The existing `vns` CLI writes the VerusID records that vDNS resolves:

```sh
node dist/cli/index.js record set google.fum@ A @ 142.250.181.238 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set chainvue.fum@ A @ 127.0.0.1 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
node dist/cli/index.js record set chainvue.fum@ REDIRECT @ http://chainvue.io/ --status 302 --ttl 300 --root fum@ --tld vrsc --verify --confirmations 1
```

Write commands preview the exact `updateidentity` payload and prompt unless `--yes` is supplied.

## Manual Fallback

If the aggregate command is not used, run the pieces directly:

```sh
pnpm build
node dist/index.js
cd coredns && ./run-local-resolver.sh
sudo scripts/macos/install-vrsc-resolver.sh
sudo scripts/macos/start-redirect-port80.sh
```

Diagnostics:

```sh
scripts/macos/diagnose-vdns.sh
scripts/macos/test-chainvue-redirect.sh
```

## Boundaries

This checkpoint does not include local TLS/CA setup, Windows/Linux installers, LaunchDaemon management, payment/product logic, or Verus record schema changes.
