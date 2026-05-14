# vDNS Record Schema

vDNS maps a `.vdns` domain to a VerusID sub-identity, then reads DNS and web records from that identity's `contentmultimap`. New records should use the vDNS VDXF key layout.

## Configurable Namespace

The root identity is configurable with `VDNS_ROOT_IDENTITY` and defaults to `vdns@`. The TLD is configurable with `VDNS_TLD` and defaults to `vdns`.

Examples with `VDNS_ROOT_IDENTITY=vdns@` and `VDNS_TLD=vdns`:

| Domain | Identity | Host |
| --- | --- | --- |
| `myname.vdns` | `myname.vdns@` | `@` |
| `www.myname.vdns` | `myname.vdns@` | `www` |
| `api.myname.vdns` | `myname.vdns@` | `api` |

Examples with `VDNS_ROOT_IDENTITY=VERUSNAMESERVICE@`:

| Domain | Identity | Host |
| --- | --- | --- |
| `myname.vdns` | `myname.VERUSNAMESERVICE@` | `@` |
| `www.myname.vdns` | `myname.VERUSNAMESERVICE@` | `www` |

Examples with `VDNS_ROOT_IDENTITY=myname.vdns@`:

| Domain | Identity | Host |
| --- | --- | --- |
| `alice.vdns` | `alice.myname.vdns@` | `@` |
| `www.alice.vdns` | `alice.myname.vdns@` | `www` |

## Domain Rules

vDNS Step 2 supports only:

- `name.<tld>`
- `host.name.<tld>`

Valid examples:

- `myname.vdns`
- `www.myname.vdns`
- `api.myname.vdns`

Invalid examples:

- `a.b.myname.vdns`
- `myname.com`
- `vdns`
- `.vdns`
- `myname.vdns.example.com`

## Records

Records are versioned JSON objects. Supported record types are `A`, `AAAA`, `CNAME`, `TXT`, `REDIRECT`, `PROXY`, `SITE`, and `TLSA`.

Common fields:

- `version` must be `1`
- `name` must be `@` or a lowercase host label such as `www`, `api`, or `mail`
- `ttl` must be an integer from `30` through `86400`

Type-specific fields:

- `A.value` must be an IPv4 address
- `AAAA.value` must be an IPv6 address
- `CNAME.value` must be a valid hostname
- `TXT.value` must be a non-empty string
- `REDIRECT.url` must use `http://` or `https://`
- `REDIRECT.status` must be `301` or `302`
- `PROXY.url` must use `http://` or `https://`
- `SITE.entry` must start with `/`
- `SITE.manifestUri` must use `http://` or `https://`; `file://` is local-development only
- `SITE.sha256`, when present, must be 64 lowercase hex characters
- `TLSA.sha256` must be 64 lowercase hex characters

## Contentmultimap Shape

Fixtures may use symbolic VDXF placeholder keys. Records are parsed from `contentmultimap["vdns.vdns::vdns.record"]` in fixture mode, and the CLI can inspect records under resolved VDXF IDs. Older `VDNS.vdns::record` and `VNS.vrsc::record` entries are accepted only as migration fallbacks.

```json
{
  "identity": "myname.vdns@",
  "contentmultimap": {
    "vdns.vdns::vdns.record": [
      {
        "version": 1,
        "type": "A",
        "name": "@",
        "value": "203.0.113.42",
        "ttl": 300
      }
    ]
  }
}
```

Real Verus writes use DataDescriptor wrappers under resolved VDXF IDs. The DataDescriptor `objectdata` field is lowercase hex-encoded UTF-8 JSON:

```json
{
  "contentmultimap": {
    "id:vdns.vdns::vdns.record": [
      {
        "i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv": {
          "version": 1,
          "label": "id:vdns.vdns::vdns.web.redirect",
          "mimetype": "application/json",
          "objectdata": "7b2276657273696f6e223a312c2274797065223a225245444952454354222c226e616d65223a2240222c2275726c223a22687474703a2f2f636861696e7675652e696f2f222c22737461747573223a3330322c2274746c223a3330307d"
        }
      }
    ]
  }
}
```

Inline raw JSON `objectdata` remains supported for old fixtures and backward compatibility only. `objectdata: null` means the stored value is incorrectly encoded or unusable and should be skipped. Decode a hex object manually with:

```sh
echo "<hex>" | xxd -r -p | jq .
```

When writing subidentity records, `updateidentity` payloads use the local identity name and parent i-address, not the fully qualified target. For example, writing `chainvue.vdns@` submits `name: "chainvue"` and `parent: "<vdns i-address>"`; reads and verification still use `chainvue.vdns@`.
