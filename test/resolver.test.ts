import { describe, expect, it, vi } from "vitest";
import type { VnsConfig } from "../src/config.js";
import { VERUS_DATA_DESCRIPTOR_KEY } from "../src/core/constants.js";
import { encodeJsonObjectData } from "../src/core/objectDataCodec.js";
import { VnsResolver } from "../src/core/resolver.js";
import type { IdentityPayload, VerusRpcLike } from "../src/core/types.js";
import { MockVerusRpcClient } from "../src/rpc/mockVerusRpcClient.js";

const baseConfig: VnsConfig = {
  rootIdentity: "VNS@",
  tld: "vrsc",
  defaultTtl: 300,
  mode: "mock",
  port: 8080,
  verusRpcTimeoutMs: 10000
};

const fumRpcConfig: VnsConfig = {
  ...baseConfig,
  rootIdentity: "fum@",
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
    TLSA: "id:tlsa"
  }
};

function makeRealStyleRpcClient(): VerusRpcLike & { getVdxfId: ReturnType<typeof vi.fn<[string], Promise<string>>> } {
  const identity: IdentityPayload = {
    identity: "google.fum@",
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
    getIdentity: vi.fn(async (requestedIdentity: string) => requestedIdentity === "google.fum@" ? identity : null),
    getVdxfId: vi.fn(async (key: string) => {
      const entries = {
        "fum.vrsc::vns.record": realVdxfIds.record,
        "fum.vrsc::vns.dns.a": realVdxfIds.labels.A,
        "fum.vrsc::vns.dns.aaaa": realVdxfIds.labels.AAAA,
        "fum.vrsc::vns.dns.cname": realVdxfIds.labels.CNAME,
        "fum.vrsc::vns.dns.txt": realVdxfIds.labels.TXT,
        "fum.vrsc::vns.web.redirect": realVdxfIds.labels.REDIRECT,
        "fum.vrsc::vns.tls.fingerprint": realVdxfIds.labels.TLSA
      };
      return entries[key as keyof typeof entries] ?? key;
    })
  };
}

describe("VnsResolver", () => {
  it("resolves an identity from mock fixtures", async () => {
    const resolver = new VnsResolver(baseConfig, new MockVerusRpcClient());
    const result = await resolver.resolveIdentity("myname.VNS@", "A");
    expect(result.identity).toBe("myname.VNS@");
    expect(result.records).toEqual([{ version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 300 }]);
  });

  it("resolves a domain and filters by host and type", async () => {
    const resolver = new VnsResolver(baseConfig, new MockVerusRpcClient());
    const result = await resolver.resolveDomain("www.myname.vrsc", "CNAME");
    expect(result.identity).toBe("myname.VNS@");
    expect(result.domain).toBe("www.myname.vrsc");
    expect(result.host).toBe("www");
    expect(result.records).toEqual([
      { version: 1, type: "CNAME", name: "www", value: "example.pages.dev", ttl: 300 }
    ]);
  });

  it("uses a custom root identity", async () => {
    const resolver = new VnsResolver(
      { ...baseConfig, rootIdentity: "VERUSNAMESERVICE@" },
      new MockVerusRpcClient()
    );
    const result = await resolver.resolveDomain("myname.vrsc");
    expect(result.identity).toBe("myname.VERUSNAMESERVICE@");
    expect(result.records).toEqual([{ version: 1, type: "A", name: "@", value: "198.51.100.25", ttl: 300 }]);
  });

  it("throws for missing identities", async () => {
    const resolver = new VnsResolver(baseConfig, new MockVerusRpcClient());
    await expect(resolver.resolveIdentity("missing.VNS@")).rejects.toThrow("Identity not found: missing.VNS@");
  });

  it("resolves a fum@ domain from real DataDescriptor-wrapped contentmultimap in RPC mode", async () => {
    const rpcClient = makeRealStyleRpcClient();
    const resolver = new VnsResolver(fumRpcConfig, rpcClient);

    await expect(resolver.resolveDomain("google.vrsc")).resolves.toEqual({
      domain: "google.vrsc",
      identity: "google.fum@",
      host: "@",
      records: [{ version: 1, type: "A", name: "@", value: "142.250.181.238", ttl: 300 }],
      warnings: []
    });
  });

  it("caches resolved VDXF IDs for an RPC resolver", async () => {
    const rpcClient = makeRealStyleRpcClient();
    const resolver = new VnsResolver({ ...fumRpcConfig, verusRpcUrl: "http://rpc-cache.local" }, rpcClient);

    await resolver.getDebugVdxfKeys();
    await resolver.resolveDomain("google.vrsc");

    expect(rpcClient.getVdxfId).toHaveBeenCalledTimes(7);
  });
});
