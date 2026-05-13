import { describe, expect, it, vi } from "vitest";
import type { VdnsConfig } from "../src/config.js";
import { VERUS_DATA_DESCRIPTOR_KEY } from "../src/core/constants.js";
import { encodeJsonObjectData } from "../src/core/objectDataCodec.js";
import { VdnsResolver } from "../src/core/resolver.js";
import type { IdentityPayload, VerusRpcLike } from "../src/core/types.js";
import { MockVerusRpcClient } from "../src/rpc/mockVerusRpcClient.js";

const baseConfig: VdnsConfig = {
  rootIdentity: "VDNS@",
  tld: "vdns",
  defaultTtl: 300,
  mode: "mock",
  port: 8080,
  verusRpcTimeoutMs: 10000
};

const fumRpcConfig: VdnsConfig = {
  ...baseConfig,
  rootIdentity: "vdns@",
  mode: "rpc",
  verusRpcUrl: "http://rpc.local"
};

const realVdxfIds = {
  record: "iFLfRN1bcVckxotkYPuWHVuoihfafbS8F5",
  labels: {
    A: "iPYBHLkzfMAnzkdQUSrqh4i7rCCW9tJpvE",
    AAAA: "id:aaaa",
    CNAME: "id:cname",
    TXT: "id:txt",
    REDIRECT: "id:redirect",
    PROXY: "id:proxy",
    SITE: "id:site",
    TLSA: "id:tlsa"
  }
};

function makeRealStyleRpcClient(): VerusRpcLike & { getVdxfId: ReturnType<typeof vi.fn<[string], Promise<string>>> } {
  const identity: IdentityPayload = {
    identity: "google.vdns@",
    contentmultimap: {
      [realVdxfIds.record]: [{
        [VERUS_DATA_DESCRIPTOR_KEY]: {
          version: 1,
          label: realVdxfIds.labels.A,
          mimetype: "application/json",
          objectdata: encodeJsonObjectData({
            version: 1,
            name: "@",
            ttl: 300,
            type: "A",
            value: "142.250.181.238"
          })
        }
      }]
    }
  };

  return {
    getIdentity: vi.fn(async (requestedIdentity: string) => requestedIdentity === "google.vdns@" ? identity : null),
    getVdxfId: vi.fn(async (key: string) => {
      const entries = {
        "vdns.vdns::vdns.record": realVdxfIds.record,
        "vdns.vdns::vdns.dns.a": realVdxfIds.labels.A,
        "vdns.vdns::vdns.dns.aaaa": realVdxfIds.labels.AAAA,
        "vdns.vdns::vdns.dns.cname": realVdxfIds.labels.CNAME,
        "vdns.vdns::vdns.dns.txt": realVdxfIds.labels.TXT,
        "vdns.vdns::vdns.web.redirect": realVdxfIds.labels.REDIRECT,
        "vdns.vdns::vdns.web.proxy": realVdxfIds.labels.PROXY,
        "vdns.vdns::vdns.web.site": realVdxfIds.labels.SITE,
        "vdns.vdns::vdns.tls.fingerprint": realVdxfIds.labels.TLSA
      };
      return entries[key as keyof typeof entries] ?? key;
    })
  };
}

describe("VdnsResolver", () => {
  it("resolves an identity from mock fixtures", async () => {
    const resolver = new VdnsResolver(baseConfig, new MockVerusRpcClient());
    const result = await resolver.resolveIdentity("myname.VDNS@", "A");
    expect(result.identity).toBe("myname.VDNS@");
    expect(result.records).toEqual([{ version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 300 }]);
  });

  it("resolves a domain and filters by host and type", async () => {
    const resolver = new VdnsResolver(baseConfig, new MockVerusRpcClient());
    const result = await resolver.resolveDomain("www.myname.vdns", "CNAME");
    expect(result.identity).toBe("myname.VDNS@");
    expect(result.domain).toBe("www.myname.vdns");
    expect(result.host).toBe("www");
    expect(result.records).toEqual([
      { version: 1, type: "CNAME", name: "www", value: "example.pages.dev", ttl: 300 }
    ]);
  });

  it("uses a custom root identity", async () => {
    const resolver = new VdnsResolver(
      { ...baseConfig, rootIdentity: "VERUSNAMESERVICE@" },
      new MockVerusRpcClient()
    );
    const result = await resolver.resolveDomain("myname.vdns");
    expect(result.identity).toBe("myname.VERUSNAMESERVICE@");
    expect(result.records).toEqual([{ version: 1, type: "A", name: "@", value: "198.51.100.25", ttl: 300 }]);
  });

  it("throws for missing identities", async () => {
    const resolver = new VdnsResolver(baseConfig, new MockVerusRpcClient());
    await expect(resolver.resolveIdentity("missing.VDNS@")).rejects.toThrow("Identity not found: missing.VDNS@");
  });

  it("resolves a vdns@ domain from real DataDescriptor-wrapped contentmultimap in RPC mode", async () => {
    const rpcClient = makeRealStyleRpcClient();
    const resolver = new VdnsResolver(fumRpcConfig, rpcClient);

    await expect(resolver.resolveDomain("google.vdns")).resolves.toEqual({
      domain: "google.vdns",
      identity: "google.vdns@",
      host: "@",
      records: [{ version: 1, type: "A", name: "@", value: "142.250.181.238", ttl: 300 }],
      warnings: []
    });
  });

  it("caches resolved VDXF IDs for an RPC resolver", async () => {
    const rpcClient = makeRealStyleRpcClient();
    const resolver = new VdnsResolver({ ...fumRpcConfig, verusRpcUrl: "http://rpc-cache.local" }, rpcClient);

    await resolver.getDebugVdxfKeys();
    await resolver.resolveDomain("google.vdns");

    expect(rpcClient.getVdxfId).toHaveBeenCalledTimes(9);
  });
});
