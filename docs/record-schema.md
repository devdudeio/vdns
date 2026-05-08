# VNS Record Schema

VNS maps a `.vrsc` domain to a VerusID sub-identity, then reads DNS and web records from that identity's `contentmultimap`.

## Configurable Namespace

The root identity is configurable with `VNS_ROOT_IDENTITY` and defaults to `fum@`. The TLD is configurable with `VNS_TLD` and defaults to `vrsc`.

Examples with `VNS_ROOT_IDENTITY=fum@` and `VNS_TLD=vrsc`:

| Domain | Identity | Host |
| --- | --- | --- |
| `myname.vrsc` | `myname.fum@` | `@` |
| `www.myname.vrsc` | `myname.fum@` | `www` |
| `api.myname.vrsc` | `myname.fum@` | `api` |

Examples with `VNS_ROOT_IDENTITY=VERUSNAMESERVICE@`:

| Domain | Identity | Host |
| --- | --- | --- |
| `myname.vrsc` | `myname.VERUSNAMESERVICE@` | `@` |
| `www.myname.vrsc` | `myname.VERUSNAMESERVICE@` | `www` |

Examples with `VNS_ROOT_IDENTITY=myname.vns@`:

| Domain | Identity | Host |
| --- | --- | --- |
| `alice.vrsc` | `alice.myname.vns@` | `@` |
| `www.alice.vrsc` | `alice.myname.vns@` | `www` |

## Domain Rules

VNS Step 2 supports only:

- `name.<tld>`
- `host.name.<tld>`

Valid examples:

- `myname.vrsc`
- `www.myname.vrsc`
- `api.myname.vrsc`

Invalid examples:

- `a.b.myname.vrsc`
- `myname.com`
- `vrsc`
- `.vrsc`
- `myname.vrsc.example.com`

## Records

Records are versioned JSON objects. Supported record types are `A`, `AAAA`, `CNAME`, `TXT`, `REDIRECT`, and `TLSA`.

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
- `TLSA.sha256` must be 64 lowercase hex characters

## Contentmultimap Shape

Fixtures may use symbolic VDXF placeholder keys. Records are parsed from `contentmultimap["VNS.vrsc::record"]` in fixture mode, and the CLI can inspect records under resolved VDXF IDs.

```json
{
  "identity": "myname.fum@",
  "contentmultimap": {
    "VNS.vrsc::record": [
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
    "id:fum.vrsc::vns.record": [
      {
        "i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv": {
          "version": 1,
          "label": "id:fum.vrsc::vns.web.redirect",
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

When writing subidentity records, `updateidentity` payloads use the local identity name and parent i-address, not the fully qualified target. For example, writing `chainvue.fum@` submits `name: "chainvue"` and `parent: "<fum i-address>"`; reads and verification still use `chainvue.fum@`.
