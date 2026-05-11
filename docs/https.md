# Local HTTPS

vDNS can run an experimental local HTTPS gateway for `https://*.vrsc`. It is opt-in and uses a per-device root CA stored under the local vDNS state directory.

This is browser TLS for local `.vrsc` names only. It does not replace VerusID record verification, create a public CA, add Let's Encrypt support, or make `.vrsc` names globally trusted outside this machine.

## Threat Model

`vdns https init-ca` creates a private root CA key on this device:

```text
$VDNS_STATE_DIR/ca/vdns-local-root-ca.pem
$VDNS_STATE_DIR/ca/vdns-local-root-ca-key.pem
```

Host certificates are generated on demand for names ending in the configured TLD, default `.vrsc`, and cached at:

```text
$VDNS_STATE_DIR/certs/<hostname>/cert.pem
$VDNS_STATE_DIR/certs/<hostname>/key.pem
```

The private CA key is sensitive. Anyone with that key can mint certificates trusted by browsers that trust the CA. vDNS restricts its own certificate generation to configured `.vrsc` hostnames, but filesystem access to the CA key still matters.

## Setup

```sh
vdns https init-ca
vdns https install-ca
```

Then set HTTPS on in your vDNS env file:

```dotenv
VDNS_HTTPS_ENABLED=true
VDNS_HTTPS_HOST=127.0.0.1
VDNS_HTTPS_PORT=443
VDNS_TLS_TLD=vrsc
VDNS_FORCE_HTTPS=false
```

Restart and check:

```sh
vdns restart
vdns https status
vdns doctor --https
open https://verus.vrsc
```

`VDNS_FORCE_HTTPS=true` is experimental. When enabled, HTTP `.vrsc` gateway requests are redirected to `https://<host><path>` before REDIRECT or PROXY handling.

## Commands

```sh
vdns https status
vdns https generate-cert verus.vrsc
vdns https list-certs
vdns https remove-cert verus.vrsc
```

The gateway also generates certificates through SNI when a browser connects to a valid `.vrsc` host.

## Uninstall

Remove trust but leave local files:

```sh
vdns https uninstall-ca
```

Remove trust, the CA files, and cached host certificates:

```sh
vdns https uninstall-ca --delete-files
```

The uninstall command does not remove vDNS records or change VerusID state.
