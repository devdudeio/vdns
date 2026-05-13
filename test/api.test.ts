import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { VdnsConfig } from "../src/config.js";
import { buildServer } from "../src/api/server.js";
import { VERUS_DATA_DESCRIPTOR_KEY } from "../src/core/constants.js";
import { encodeJsonObjectData } from "../src/core/objectDataCodec.js";
import { VdnsResolver } from "../src/core/resolver.js";
import type { IdentityPayload, VerusRpcLike } from "../src/core/types.js";
import { MockVerusRpcClient } from "../src/rpc/mockVerusRpcClient.js";
import { VerusRpcError } from "../src/rpc/verusRpcClient.js";

const config: VdnsConfig = {
  rootIdentity: "VDNS@",
  tld: "vdns",
  defaultTtl: 300,
  mode: "mock",
  port: 8080,
  verusRpcTimeoutMs: 10000
};

let app: FastifyInstance | undefined;

async function makeApp(customConfig: VdnsConfig = config): Promise<FastifyInstance> {
  app = await buildServer(new VdnsResolver(customConfig, new MockVerusRpcClient()));
  return app;
}

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("api", () => {
  it("responds to health", async () => {
    const server = await makeApp();
    const response = await server.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("resolves an identity", async () => {
    const server = await makeApp();
    const response = await server.inject({ method: "GET", url: "/resolve/myname.VDNS@?type=A" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      identity: "myname.VDNS@",
      records: [{ version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 300 }],
      warnings: []
    });
  });

  it("resolves a domain", async () => {
    const server = await makeApp();
    const response = await server.inject({ method: "GET", url: "/resolve-domain/www.myname.vdns?type=CNAME" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      identity: "myname.VDNS@",
      domain: "www.myname.vdns",
      host: "www",
      records: [{ version: 1, type: "CNAME", name: "www", value: "example.pages.dev", ttl: 300 }],
      warnings: []
    });
  });

  it("resolves a custom root identity", async () => {
    const server = await makeApp({ ...config, rootIdentity: "VERUSNAMESERVICE@" });
    const response = await server.inject({ method: "GET", url: "/resolve-domain/myname.vdns" });
    expect(response.statusCode).toBe(200);
    expect(response.json().identity).toBe("myname.VERUSNAMESERVICE@");
  });

  it("rejects invalid domains and types", async () => {
    const server = await makeApp();
    const badDomain = await server.inject({ method: "GET", url: "/resolve-domain/a.b.myname.vdns" });
    const badType = await server.inject({ method: "GET", url: "/resolve-domain/myname.vdns?type=MX" });
    expect(badDomain.statusCode).toBe(400);
    expect(badType.statusCode).toBe(400);
  });

  it("redacts debug config", async () => {
    const server = await makeApp({
      ...config,
      mode: "rpc",
      verusRpcUrl: "https://user:secret@api.verustest.net/",
      verusRpcUser: "user",
      verusRpcPassword: "secret"
    });
    const response = await server.inject({ method: "GET", url: "/debug/config" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      mode: "rpc",
      rootIdentity: "VDNS@",
      tld: "vdns",
      defaultTtl: 300,
      port: 8080,
      rpcUrlConfigured: true,
      rpcUrlHost: "api.verustest.net",
      rpcAuthConfigured: true,
      rpcTimeoutMs: 10000
    });
    expect(response.body).not.toContain("secret");
    expect(response.body).not.toContain("user:");
  });

  it("returns raw identity fixtures in mock mode", async () => {
    const server = await makeApp();
    const response = await server.inject({ method: "GET", url: "/debug/raw-identity/myname.VDNS@" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ identity: "myname.VDNS@" });
  });

  it("returns mock RPC health", async () => {
    const server = await makeApp();
    const response = await server.inject({ method: "GET", url: "/debug/rpc-health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ mode: "mock", status: "ok" });
  });

  it("returns vDNS VDXF key names in mock mode", async () => {
    const server = await makeApp({ ...config, rootIdentity: "vdns@" });
    const response = await server.inject({ method: "GET", url: "/debug/vdxf-keys" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      rootIdentity: "vdns@",
      tld: "vdns",
      keys: {
        record: {
          name: "vdns.vdns::vdns.record",
          vdxfid: "vdns.vdns::vdns.record"
        },
        dnsA: {
          name: "vdns.vdns::vdns.dns.a",
          vdxfid: "vdns.vdns::vdns.dns.a"
        }
      }
    });
  });

  it("returns 404 for missing identities", async () => {
    const server = await makeApp();
    const resolve = await server.inject({ method: "GET", url: "/resolve/missing.VDNS@" });
    const domain = await server.inject({ method: "GET", url: "/resolve-domain/missing.vdns" });
    expect(resolve.statusCode).toBe(404);
    expect(domain.statusCode).toBe(404);
    expect(domain.json()).toMatchObject({
      message: "Identity not found: missing.VDNS@",
      details: {
        mode: "mock",
        rootIdentity: "VDNS@",
        tld: "vdns"
      }
    });
  });

  it("resolves real DataDescriptor records in RPC mode using resolved VDXF IDs", async () => {
    const server = await makeAppWithRpcClient(makeRealStyleRpcClient(), {
      ...config,
      mode: "rpc",
      rootIdentity: "vdns@",
      verusRpcUrl: "http://rpc.local"
    });
    const response = await server.inject({ method: "GET", url: "/resolve-domain/google.vdns" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      domain: "google.vdns",
      identity: "google.vdns@",
      host: "@",
      records: [{ version: 1, type: "A", name: "@", value: "142.250.181.238", ttl: 300 }],
      warnings: []
    });
  });

  it("maps RPC upstream errors to 502", async () => {
    const server = await makeAppWithRpcClient({
      async getIdentity(): Promise<IdentityPayload | null> {
        throw new VerusRpcError("rpc", "Verus RPC getidentity error -32601", undefined, -32601);
      }
    });
    const response = await server.inject({ method: "GET", url: "/resolve/myname.VDNS@" });
    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("Verus RPC upstream error");
  });

  it("maps RPC timeouts to 504", async () => {
    const server = await makeAppWithRpcClient({
      async getIdentity(): Promise<IdentityPayload | null> {
        throw new VerusRpcError("timeout", "Verus RPC getidentity timed out after 1ms");
      }
    });
    const response = await server.inject({ method: "GET", url: "/resolve/myname.VDNS@" });
    expect(response.statusCode).toBe(504);
    expect(response.json().message).toBe("Verus RPC request timed out");
  });
});

async function makeAppWithRpcClient(
  rpcClient: VerusRpcLike,
  customConfig: VdnsConfig = { ...config, mode: "rpc" }
): Promise<FastifyInstance> {
  app = await buildServer(new VdnsResolver(customConfig, rpcClient));
  return app;
}

function makeRealStyleRpcClient(): VerusRpcLike {
  const recordId = "iFLfRN1bcVckxotkYPuWHVuoihfafbS8F5";
  const dnsAId = "iPYBHLkzfMAnzkdQUSrqh4i7rCCW9tJpvE";
  const identity: IdentityPayload = {
    identity: "google.vdns@",
    contentmultimap: {
      [recordId]: [{
        [VERUS_DATA_DESCRIPTOR_KEY]: {
          version: 1,
          label: dnsAId,
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
    async getIdentity(requestedIdentity: string): Promise<IdentityPayload | null> {
      return requestedIdentity === "google.vdns@" ? identity : null;
    },
    async getVdxfId(key: string): Promise<string> {
      const ids: Record<string, string> = {
        "vdns.vdns::vdns.record": recordId,
        "vdns.vdns::vdns.dns.a": dnsAId,
        "vdns.vdns::vdns.dns.aaaa": "id:aaaa",
        "vdns.vdns::vdns.dns.cname": "id:cname",
        "vdns.vdns::vdns.dns.txt": "id:txt",
        "vdns.vdns::vdns.web.redirect": "id:redirect",
        "vdns.vdns::vdns.web.proxy": "id:proxy",
        "vdns.vdns::vdns.web.site": "id:site",
        "vdns.vdns::vdns.tls.fingerprint": "id:tlsa"
      };
      return ids[key] ?? key;
    }
  };
}
