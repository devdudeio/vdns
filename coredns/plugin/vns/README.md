# CoreDNS VNS Plugin

`vns` is a thin CoreDNS adapter for the VNS HTTP resolver. It does not talk to Verus RPC directly. DNS queries are mapped to `GET /resolve-domain/:domain?type=:TYPE`, and normalized VNS records are converted to DNS answers.

## Corefiles

Use `coredns/Corefile.vrsc-only.example` for isolated `.vrsc` testing. It only serves the `vrsc` zone on port `1053`; normal DNS names such as `google.com` are not forwarded by that Corefile.

```corefile
vrsc:1053 {
  bind 127.0.0.1

  vns {
    resolver_url http://127.0.0.1:8080
    timeout 3s
  }

  errors
  log
  cache 30
}
```

Use `coredns/Corefile.local-resolver.example` for local resolver testing. It serves `.vrsc` through VNS and forwards all other DNS to upstream resolvers:

```corefile
vrsc:1053 {
  bind 127.0.0.1

  vns {
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

Start CoreDNS local resolver mode:

```sh
cd coredns
./build-coredns.sh
./run-local-resolver.sh
```

From the repo root, install the macOS split-DNS resolver file:

```sh
sudo scripts/macos/install-vrsc-resolver.sh
```

Verify:

```sh
scutil --dns | grep -A5 'domain   : vrsc'
dig google.vrsc A +short
dig google.com A +short
```

Uninstall:

```sh
sudo scripts/macos/uninstall-vrsc-resolver.sh
```

Troubleshooting:

- Confirm CoreDNS is listening on `127.0.0.1:1053` with `scripts/macos/status-vrsc-resolver.sh`.
- Confirm `/etc/resolver/vrsc` exists.
- Confirm `scutil --dns` shows a `vrsc` resolver.
- Confirm the VNS HTTP resolver is running.
- Do not edit `/etc/resolv.conf`; macOS manages that file.

## Supported Records

- `A`
- `AAAA`
- `CNAME`
- `TXT`

`REDIRECT` is not a DNS record and is ignored by this MVP. `TLSA` is reserved for a later step.

## Response Behavior

- No records: `NOERROR` with no answers.
- HTTP 404 from VNS resolver: `NXDOMAIN`.
- Unreachable resolver or HTTP 5xx: `SERVFAIL`.
- Unsupported DNS query type: `NOERROR` with no answers.

## Tests

```sh
cd coredns/plugin/vns
CGO_ENABLED=0 go test ./...
```
