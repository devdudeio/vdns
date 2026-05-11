# Troubleshooting

Start with:

```sh
vdns doctor
vdns status
vdns logs
```

Use `vdns doctor --strict` when validating the demo records before a release or public demo.

## `dig google.vrsc` Is Empty On macOS

`dig` does not always use macOS `/etc/resolver` split-DNS routing unless you point it at the vDNS CoreDNS listener.

Check direct CoreDNS:

```sh
dig @127.0.0.1 -p 1053 google.vrsc A +short
```

Check system resolver behavior:

```sh
dscacheutil -q host -a name google.vrsc
scutil --dns | grep -A5 vrsc
cat /etc/resolver/vrsc
```

Fixes:

```sh
vdns install
vdns start
sudo killall -HUP mDNSResponder
vdns logs coredns
```

## `http://chainvue.vrsc` Hangs

Check DNS and the local web gateway separately:

```sh
dscacheutil -q host -a name chainvue.vrsc
curl -i --max-time 10 http://chainvue.vrsc
curl "http://127.0.0.1:8081/debug/resolve?host=chainvue.vrsc"
vdns logs gateway
```

Expected REDIRECT result:

```text
HTTP 302
Location: http://chainvue.io/
```

Fixes:

```sh
vdns restart
vdns doctor
vdns logs gateway --tail
```

If port `80` is hidden because it is root-owned, use:

```sh
sudo lsof -nP -iTCP:80 -sTCP:LISTEN
```

## Resolver Running In Mock Mode

Check:

```sh
curl http://127.0.0.1:8080/debug/config
vdns doctor
```

If `"mode":"mock"` appears, remove shell overrides and update `~/.vdns/.env.local`:

```sh
unset VNS_MODE
grep VNS_MODE ~/.vdns/.env.local
vdns restart
```

For real Verus records, use:

```dotenv
VNS_MODE=rpc
VERUS_RPC_URL=http://127.0.0.1:18843
```

## `verus.vrsc` PROXY Failures

Check:

```sh
curl -I --max-time 20 http://verus.vrsc
curl "http://127.0.0.1:8081/debug/resolve?host=verus.vrsc"
vdns logs gateway
vdns doctor --strict
```

Expected headers:

```text
x-vdns-proxy: 1
x-vdns-proxy-target-host: verus.io
```

Fixes:

```sh
grep VDNS_PROXY_ENABLED ~/.vdns/.env.local
vdns restart
vdns logs gateway --tail
```

PROXY targets that resolve to localhost, private, or internal literal addresses are blocked by default.

