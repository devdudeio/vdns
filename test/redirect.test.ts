import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RedirectConfig } from "../src/redirect/config.js";
import { normalizeHostHeader } from "../src/redirect/safety.js";
import { buildHttpsRedirectServer, buildRedirectServer } from "../src/redirect/server.js";
import { sha256Hex } from "../src/core/site.js";
import { RedirectResolverError, type ProxyRecord, type RedirectRecord, type RedirectResolverClient, type SiteRecord } from "../src/redirect/types.js";
import { initCa } from "../src/tls/certs.js";
import { deriveTlsPaths } from "../src/tls/paths.js";

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
  proxyMaxRedirects: 3,
  proxyAllowPrivateTargets: false,
  httpsEnabled: false,
  httpsHost: "127.0.0.1",
  httpsPort: 443,
  tlsTld: "vrsc",
  tlsCaDir: undefined,
  tlsCertDir: undefined,
  tlsCertValidityDays: 397,
  forceHttps: false,
  siteCacheEnabled: true,
  siteMaxFileBytes: 10485760,
  siteMaxTotalManifestBytes: 1048576,
  siteAllowFileUri: false
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
    expect(response.json()).toEqual({ status: "ok", service: "vdns-gateway" });
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

  it("optionally redirects HTTP vDNS requests to HTTPS before record handling", async () => {
    const server = await makeApp(record("https://chainvue.io/"), undefined, null, { forceHttps: true });
    const response = await server.inject({ method: "GET", url: "/docs?a=1", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("https://chainvue.vrsc/docs?a=1");
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
    expect(response.headers["x-vdns-proxy"]).toBe("1");
    expect(response.headers["x-vdns-proxy-target-host"]).toBe("upstream.example");
    expect(response.headers["x-vdns-source-host"]).toBe("chainvue.vrsc");
    expect(fetchImpl).toHaveBeenCalledWith("https://upstream.example/base/docs?a=1", expect.objectContaining({ redirect: "manual" }));
  });

  it("maps proxy root target paths safely", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const server = await makeApp(null, undefined, proxyRecord("https://verus.io/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    await server.inject({ method: "GET", url: "/technology?x=1", headers: { host: "verus.vrsc" } });

    expect(fetchImpl).toHaveBeenCalledWith("https://verus.io/technology?x=1", expect.anything());
  });

  it("proxies HEAD headers with no body", async () => {
    const fetchImpl = vi.fn(async () => new Response("hidden", {
      status: 200,
      headers: { "content-type": "text/html" }
    }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "HEAD", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("");
    expect(response.headers["x-vdns-proxy"]).toBe("1");
  });

  it("strips unsafe outbound proxy request headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    await server.inject({
      method: "GET",
      url: "/",
      headers: {
        host: "chainvue.vrsc",
        "accept-encoding": "gzip",
        "content-length": "12",
        "x-custom": "kept"
      }
    });

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("host")).toBeNull();
    expect(headers.get("accept-encoding")).toBeNull();
    expect(headers.get("content-length")).toBeNull();
    expect(headers.get("x-custom")).toBe("kept");
  });

  it("returns 405 for unsupported gateway methods", async () => {
    const fetchImpl = vi.fn();
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "POST", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(405);
    expect(response.headers.allow).toBe("GET, HEAD");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("strips unsafe upstream response headers", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", {
      status: 200,
      headers: {
        "content-type": "text/plain",
        "content-security-policy": "default-src 'none'",
        "strict-transport-security": "max-age=1",
        "x-frame-options": "DENY",
        "set-cookie": "a=b",
        "connection": "close",
        "transfer-encoding": "chunked"
      }
    }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-security-policy"]).toBeUndefined();
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.headers["x-frame-options"]).toBeUndefined();
    expect(response.headers["set-cookie"]).toBeUndefined();
    expect(response.headers["transfer-encoding"]).toBeUndefined();
  });

  it("follows validated upstream redirects server-side", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://upstream.example/") {
        return new Response(null, { status: 302, headers: { location: "https://target.example/final" } });
      }
      return new Response("final", { status: 200, headers: { "content-type": "text/plain" } });
    });
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("final");
    expect(response.headers.location).toBeUndefined();
    expect(response.headers["x-vdns-proxy-target-host"]).toBe("target.example");
  });

  it("rejects unsafe upstream redirects before fetching them", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain("PROXY target rejected:");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed upstream redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://[::1" } }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toContain("PROXY target rejected:");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops following redirects at the configured limit", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://target.example/next" } }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true, proxyMaxRedirects: 1 }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("PROXY redirect limit exceeded");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects private proxy targets and same-host loops", async () => {
    const privateServer = await makeApp(null, undefined, proxyRecord("http://127.0.0.1:9000/"), { proxyEnabled: true });
    const privateResponse = await privateServer.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });
    expect(privateResponse.statusCode).toBe(502);
    expect(privateResponse.json().message).toContain("PROXY target rejected:");

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

  it("rejects oversized proxied responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("abc", { headers: { "content-length": "3" } }));
    const server = await makeApp(null, undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true, proxyMaxBodyBytes: 2 }, fetchImpl as typeof fetch);
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "chainvue.vrsc" } });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("Proxy upstream response is too large");
  });

  it("serves SITE entry files and direct asset paths after REDIRECT misses", async () => {
    const index = Buffer.from("<main>home</main>");
    const appJs = Buffer.from("console.log('ok');");
    const manifest = {
      version: 1,
      type: "VDNS_SITE_MANIFEST",
      entry: "/index.html",
      spaFallback: true,
      files: [
        { path: "/index.html", mime: "text/html; charset=utf-8", size: index.byteLength, sha256: sha256Hex(index), uri: "https://cdn.example/index.html" },
        { path: "/assets/app.js", mime: "text/javascript; charset=utf-8", size: appJs.byteLength, sha256: sha256Hex(appJs), uri: "https://cdn.example/assets/app.js" }
      ]
    };
    const manifestBody = Buffer.from(JSON.stringify(manifest));
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "https://cdn.example/manifest.json") {
        return new Response(manifestBody, { headers: { "content-type": "application/json" } });
      }
      if (String(url) === "https://cdn.example/assets/app.js") {
        return new Response(appJs);
      }
      return new Response(index);
    });
    const server = await makeApp(null, undefined, null, {}, fetchImpl as typeof fetch, siteRecord("https://cdn.example/manifest.json", sha256Hex(manifestBody)));

    const root = await server.inject({ method: "GET", url: "/", headers: { host: "site.vrsc" } });
    expect(root.statusCode).toBe(200);
    expect(root.body).toBe("<main>home</main>");
    expect(root.headers["x-vdns-site"]).toBe("1");

    const asset = await server.inject({ method: "GET", url: "/assets/app.js", headers: { host: "site.vrsc" } });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers["content-type"]).toContain("text/javascript");
    expect(asset.body).toBe("console.log('ok');");
  });

  it("keeps PROXY and REDIRECT priority ahead of SITE", async () => {
    const fetchImpl = vi.fn(async () => new Response("proxied"));
    const server = await makeApp(record("https://chainvue.io/"), undefined, proxyRecord("https://upstream.example/"), { proxyEnabled: true }, fetchImpl as typeof fetch, siteRecord("https://cdn.example/manifest.json"));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "site.vrsc" } });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("proxied");
  });

  it("rejects SITE hash mismatches", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ version: 1, type: "VDNS_SITE_MANIFEST", entry: "/index.html", spaFallback: false, files: [] })));
    const server = await makeApp(null, undefined, null, {}, fetchImpl as typeof fetch, siteRecord("https://cdn.example/manifest.json", "a".repeat(64)));
    const response = await server.inject({ method: "GET", url: "/", headers: { host: "site.vrsc" } });

    expect(response.statusCode).toBe(502);
    expect(response.json().message).toBe("SITE manifest hash mismatch");
  });

  it("builds an HTTPS gateway with generated default certificate cache", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-https-gateway-"));
    try {
      const paths = deriveTlsPaths({ VDNS_STATE_DIR: stateDir });
      await initCa({ paths });
      const resolver = makeResolver(record("https://chainvue.io/"));
      app = await buildHttpsRedirectServer({ ...config, tlsCaDir: paths.caDir, tlsCertDir: paths.certDir }, { resolver });

      await expect(stat(path.join(paths.certDir, "verus.vrsc", "cert.pem"))).resolves.toBeTruthy();
      await expect(stat(path.join(paths.certDir, "verus.vrsc", "key.pem"))).resolves.toBeTruthy();
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});

async function makeApp(
  redirectResult: RedirectRecord | RedirectResolverError | null,
  onResolve?: (hostname: string) => void,
  proxyResult: ProxyRecord | RedirectResolverError | null = null,
  configOverrides: Partial<RedirectConfig> = {},
  fetchImpl?: typeof fetch,
  siteResult: SiteRecord | RedirectResolverError | null = null
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
    },
    async resolveSite(hostname: string): Promise<SiteRecord | null> {
      onResolve?.(hostname);
      if (siteResult instanceof RedirectResolverError) {
        throw siteResult;
      }
      return siteResult;
    }
  };

  app = await buildRedirectServer({ ...config, ...configOverrides }, { resolver, fetchImpl });
  return app;
}

function makeResolver(redirectResult: RedirectRecord | null): RedirectResolverClient {
  return {
    async resolveRedirect(): Promise<RedirectRecord | null> {
      return redirectResult;
    },
    async resolveProxy(): Promise<ProxyRecord | null> {
      return null;
    }
  };
}


function record(url: string, status: 301 | 302 = 302): RedirectRecord {
  return { version: 1, type: "REDIRECT", name: "@", url, status, ttl: 300 };
}

function proxyRecord(url: string): ProxyRecord {
  return { version: 1, type: "PROXY", name: "@", url, ttl: 300 };
}

function siteRecord(manifestUri: string, sha256?: string): SiteRecord {
  return { version: 1, type: "SITE", name: "@", entry: "/index.html", manifestUri, ...(sha256 ? { sha256 } : {}), ttl: 300 };
}
