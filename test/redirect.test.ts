import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { RedirectConfig } from "../src/redirect/config.js";
import { normalizeHostHeader } from "../src/redirect/safety.js";
import { buildRedirectServer } from "../src/redirect/server.js";
import { RedirectResolverError, type RedirectRecord, type RedirectResolverClient } from "../src/redirect/types.js";

const config: RedirectConfig = {
  host: "127.0.0.1",
  port: 8081,
  resolverUrl: "http://127.0.0.1:8080",
  tld: "vrsc",
  defaultStatus: 302,
  timeoutMs: 5000
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
});

async function makeApp(
  result: RedirectRecord | RedirectResolverError | null,
  onResolve?: (hostname: string) => void
): Promise<FastifyInstance> {
  const resolver: RedirectResolverClient = {
    async resolveRedirect(hostname: string): Promise<RedirectRecord | null> {
      onResolve?.(hostname);
      if (result instanceof RedirectResolverError) {
        throw result;
      }
      return result;
    }
  };

  app = await buildRedirectServer(config, { resolver });
  return app;
}

function record(url: string, status: 301 | 302 = 302): RedirectRecord {
  return { version: 1, type: "REDIRECT", name: "@", url, status, ttl: 300 };
}
