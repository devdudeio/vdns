# CoreDNS vDNS Plugin

`vdns` is a thin CoreDNS adapter for the vDNS HTTP resolver. It does not talk to Verus RPC directly. DNS queries are mapped to `GET /resolve-domain/:domain?type=:TYPE`, and normalized vDNS records are converted to DNS answers.

## Corefiles

Use `coredns/Corefile.vdns-only.example` for isolated `.vdns` testing. It only serves the `vdns` zone on port `1053`; normal DNS names such as `google.com` are not forwarded by that Corefile.

```corefile
vdns:1053 {
  bind 127.0.0.1

  vdns {
    resolver_url http://127.0.0.1:8080
    timeout 3s
  }

  errors
  log
  cache 30
}
```

Use `coredns/Corefile.local-resolver.example` for local resolver testing. It serves `.vdns` through vDNS and forwards all other DNS to upstream resolvers:

```corefile
vdns:1053 {
  bind 127.0.0.1

  vdns {
    resolver_url http://127.0.0.1:8080
    timeout 3s
  }

  errors
  log
  cache 30
}

.:1053 {
  bind 127.0.0.1

  forward . 1.1.1.1 9.9.9.9
  cache 300
  errors
  log
}
```

Docker Desktop users can use `http://host.docker.internal:8080` for `resolver_url`. `Corefile.local-resolver-53.example` is the same pattern on port `53`; that usually requires elevated privileges and may conflict with system DNS services.

## macOS Split-DNS Setup For `.vdns`

macOS can route only `.vdns` lookups to the local CoreDNS/vDNS resolver with `/etc/resolver/vdns`. Normal DNS names stay on the system resolver path.

Start the vDNS HTTP resolver in RPC mode:

```sh
VDNS_MODE=rpc \
VDNS_ROOT_IDENTITY=fum@ \
VDNS_TLD=vdns \
VERUS_RPC_URL=http://192.168.0.106:18843 \
VERUS_RPC_USER=... \
VERUS_RPC_PASSWORD=... \
pnpm dev
```

Start CoreDNS local resolver mode:

```sh
cd coredns
./build-coredns.sh
./run-local-resolver.sh
```

From the repo root, install the macOS split-DNS resolver file:

```sh
sudo scripts/macos/install-vdns-resolver.sh
```

Verify:

```sh
scutil --dns | grep -A5 'domain   : vdns'
dig google.vdns A +short
dig google.com A +short
```

Uninstall:

```sh
sudo scripts/macos/uninstall-vdns-resolver.sh
```

Troubleshooting:

- Confirm CoreDNS is listening on `127.0.0.1:1053` with `scripts/macos/status-vdns-resolver.sh`.
- Confirm `/etc/resolver/vdns` exists.
- Confirm `scutil --dns` shows a `vdns` resolver.
- Confirm the vDNS HTTP resolver is running.
- Do not edit `/etc/resolv.conf`; macOS manages that file.

## Supported Records

- `A`
- `AAAA`
- `CNAME`
- `TXT`

`REDIRECT` is not a DNS record and is ignored by this MVP. `TLSA` is reserved for a later step.

## Response Behavior

- No records: `NOERROR` with no answers.
- HTTP 404 from vDNS resolver: `NXDOMAIN`.
- Unreachable resolver or HTTP 5xx: `SERVFAIL`.
- Unsupported DNS query type: `NOERROR` with no answers.

## Tests

```sh
cd coredns/plugin/vdns
CGO_ENABLED=0 go test ./...
```
