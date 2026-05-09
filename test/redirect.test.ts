import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RedirectConfig } from "../src/redirect/config.js";
import { normalizeHostHeader } from "../src/redirect/safety.js";
import { buildRedirectServer } from "../src/redirect/server.js";
import { RedirectResolverError, type ProxyRecord, type RedirectRecord, type RedirectResolverClient } from "../src/redirect/types.js";

const config: RedirectConfig = {
  host: "127.0.0.1",
  port: 8081,
  resolverUrl: "http://127.0.0.1:8080",
  tld: "vrsc",
  defaultStatus: 302,
  timeoutMs: 5000,
  proxyEnabled: false,
  proxyTimeoutMs: 5000,
  proxyMaxBodyBytes: 10485760,
  proxyFollowRedirects: "manual"
};

let app: FastifyInstance | undefined;

afterEach(async () => {
  if (app) {
    await app.close();
    app = undefined;
  }
});

describe("redirect service", () => {
  it("responds to health for any host", async () => {
    const server = await makeApp(record("https://chainvue.io/"));
    const response = await server.inject({ method: "GET", url: "/health", headers: { host: "example.com" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok", service: "vns-redirect" });
  });

  it("redirects a vrsc host with a REDIRECT record", async () => {
    const server = await makeApp(record("https://chainvue.io/"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://chainvue.io/");
  });

  it.each(["chainvue.vrsc", "chainvue.vrsc:80", "chainvue.vrsc:8081"])(
    "accepts curl-style Host %s",
    async (host) => {
      let requestedHost = "";
      const server = await makeApp(record("https://chainvue.io/"), (hostname) => {
        requestedHost = hostname;
      });
      const response = await server.inject({ method: "GET", url: "/", headers: { host } });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe("https://chainvue.io/");
      expect(requestedHost).toBe("chainvue.vrsc");
    }
  );

  it("honors REDIRECT status 301", async () => {
    const server = await makeApp(record("https://chainvue.io/", 301));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe("https://chainvue.io/");
  });

  it("returns 400 for missing Host", async () => {
    expect(normalizeHostHeader(undefined)).toEqual(new Error("Host header is required"));
  });

  it("rejects invalid Host values", async () => {
    const server = await makeApp(record("https://chainvue.io/"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "bad host.vrsc" } });
    expect(response.statusCode).toBe(400);
  });

  it("returns 404 for non-vrsc hosts", async () => {
    const server = await makeApp(record("https://chainvue.io/"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "example.com" } });
    expect(response.statusCode).toBe(404);
  });

  it("maps resolver 404 or no matching redirect to 404", async () => {
    const server = await makeApp(null);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(404);
  });

  it("maps resolver 500 to 502", async () => {
    const server = await makeApp(new RedirectResolverError("upstream", "Resolver returned 500"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(502);
  });

  it("maps resolver timeout to 504", async () => {
    const server = await makeApp(new RedirectResolverError("timeout", "Resolver request timed out"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(504);
  });

  it("rejects invalid target schemes", async () => {
    const server = await makeApp(record("javascript:alert(1)"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(502);
  });

  it("rejects same-host redirect loops", async () => {
    const server = await makeApp(record("https://chainvue.vrsc/path"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(508);
  });

  it("normalizes Host with an optional port", async () => {
    let requestedHost = "";
    const server = await makeApp(record("https://chainvue.io/"), (hostname) => {
      requestedHost = hostname;
    });
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc:8081" } });
    expect(response.statusCode).toBe(302);
    expect(requestedHost).toBe("chainvue.vrsc");
  });

  it("returns HEAD redirects with Location and no body", async () => {
    const server = await makeApp(record("https://chainvue.io/"));
    const response = await server.inject({ method: "HEAD", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://chainvue.io/");
    expect(response.body).toBe("");
  });

  it("does not proxy when VDNS_PROXY_ENABLED is false", async () => {
    const fetchImpl = vi.fn();
    const server = await makeApp(record("https://chainvue.io/"), undefined, proxyRecord("https://upstream.example/"), {}, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(302);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("proxies path and query when enabled", async () => {
    const fetchImpl = vi.fn(async () => new Response("proxied", {
      status: 200,
      headers: { "content-type": "text/plain", "cache-control": "max-age=60" }
    }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/base/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/docs?a=1", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("proxied");
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(fetchImpl).toHaveBeenCalledWith("https://upstream.example/base/docs?a=1", expect.objectContaining({ redirect: "manual" }));
  });

  it("strips unsafe upstream response headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-security-policy": "default-src 'none'",
        "strict-transport-security": "max-age=1",
        "x-frame-options": "DENY",
        "set-cookie": "a=b"
      }
    }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
  });

  it("passes through manual upstream redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://target.example/" } }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://target.example/");
  });

  it("rejects private proxy targets and same-host loops", async () => {
    const privateServer = await makeApp(null, undefined, proxyRecord("http://127.0.0.1:9000/"), { proxyEnabled: true });
    const privateResponse = await privateServer.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(privateResponse.statusCode).toBe(502);

    await privateServer.close();
    app = undefined;

    const loopServer = await makeApp(null, undefined, proxyRecord("https://chainvue.vrsc/"), { proxyEnabled: true });
    const loopResponse = await loopServer.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(loopResponse.statusCode).toBe(508);
  });

  it("maps proxy timeout and upstream 500", async () => {
    const timeoutFetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
      return new Response("late");
    });
    const timeoutServer = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true, proxyTimeoutMs: 1 }, timeoutFetch as typeof fetch);
    const timeoutResponse = await timeoutServer.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(timeoutResponse.statusCode).toBe(504);

    await timeoutServer.close();
    app = undefined;

    const upstreamFetch = vi.fn(async () => new Response("upstream failed", { status: 500 }));
    const upstreamServer = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, upstreamFetch as typeof fetch);
    const upstreamResponse = await upstreamServer.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(upstreamResponse.statusCode).toBe(500);
    expect(upstreamResponse.body).toBe("upstream failed");
  });
});

async function makeApp(
  redirectResult: RedirectRecord | RedirectResolverError | null,
  onResolve?: (hostname: string) => void,
  proxyResult: ProxyRecord | RedirectResolverError | null = null,
  configOverrides: Partial<RedirectConfig> = {},
  fetchImpl?: typeof fetch
): Promise<FastifyInstance> {
  const resolver: RedirectResolverClient = {
    async resolveRedirect(hostname: string): Promise<RedirectRecord | null> {
      onResolve?.(hostname);
      if (redirectResult instanceof RedirectResolverError) {
        throw redirectResult;
      }
      return redirectResult;
    },
    async resolveProxy(hostname: string): Promise<ProxyRecord | null> {
      onResolve?.(hostname);
      if (proxyResult instanceof RedirectResolverError) {
        throw proxyResult;
      }
      return proxyResult;
    }
  };

  app = await buildRedirectServer({ ...config, ...configOverrides }, { resolver, fetchImpl });
  return app;
}

function record(url: string, status: 301 | 302 = 302): RedirectRecord {
  return { version: 1, type: "REDIRECT", name: "@", url, status, ttl: 300 };
}

function proxyRecord(url: string): ProxyRecord {
  return { version: 1, type: "PROXY", name: "@", url, ttl: 300 };
}
