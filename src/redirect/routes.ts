import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RedirectConfig } from "./config.js";
import { validateProxyTargetUrl } from "./proxySecurity.js";
import { isConfiguredTldHost, isLocalClient, normalizeHostHeader, redirectStatus, validateRedirectTarget } from "./safety.js";
import { RedirectResolverError, type ProxyRecord, type RedirectResolverClient } from "./types.js";

type DebugResolveQuery = {
  host?: string;
};

type RouteOptions = {
  config: RedirectConfig;
  resolver: RedirectResolverClient;
  fetchImpl?: typeof fetch;
};

type DebugCapableResolver = RedirectResolverClient & {
  resolveDebug?(hostname: string): Promise<unknown>;
};

const strippedRequestHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding"
]);

const strippedResponseHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "x-frame-options",
  "set-cookie",
  "set-cookie2",
  "content-length",
  "content-encoding"
]);

const preservedResponseHeaders = new Set([
  "content-type",
  "cache-control",
  "etag",
  "last-modified",
  "expires",
  "content-language",
  "location"
]);

export async function registerRedirectRoutes(app: FastifyInstance, options: RouteOptions): Promise<void> {
  app.get("/health", async () => ({ status: "ok", service: "vns-redirect" }));

  app.get<{ Querystring: DebugResolveQuery }>("/debug/resolve", async (request, reply) => {
    if (!isLocalClient(request.ip)) {
      return reply.code(403).send({ statusCode: 403, error: "Forbidden", message: "Debug resolve is local-only" });
    }

    const hostname = normalizeHostHeader(request.query.host);
    if (hostname instanceof Error) {
      return reply.badRequest(hostname.message);
    }
    if (!isConfiguredTldHost(hostname, options.config.tld)) {
      return reply.notFound();
    }

    const resolver = options.resolver as DebugCapableResolver;
    try {
      if (typeof resolver.resolveDebug === "function") {
        return await resolver.resolveDebug(hostname);
      }
      return {
        hostname,
        selectedRecord: await resolver.resolveRedirect(hostname),
        selectedProxyRecord: options.config.proxyEnabled && resolver.resolveProxy
          ? await resolver.resolveProxy(hostname)
          : null
      };
    } catch (error) {
      return sendResolverError(reply, error);
    }
  });

  app.all("/*", async (request, reply) => handleGatewayRequest(request, reply, options));
}

async function handleGatewayRequest(request: FastifyRequest, reply: FastifyReply, options: RouteOptions) {
  const hostname = normalizeHostHeader(request.headers.host);
  if (hostname instanceof Error) {
    return reply.badRequest(hostname.message);
  }

  if (!isConfiguredTldHost(hostname, options.config.tld)) {
    return reply.notFound();
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply
      .code(405)
      .header("Allow", "GET, HEAD")
      .send({ statusCode: 405, error: "Method Not Allowed", message: "Web gateway only supports GET and HEAD" });
  }

  if (options.config.proxyEnabled) {
    let proxyRecord: ProxyRecord | null = null;
    try {
      proxyRecord = options.resolver.resolveProxy ? await options.resolver.resolveProxy(hostname) : null;
    } catch (error) {
      return sendResolverError(reply, error);
    }

    if (proxyRecord) {
      return proxyRequest(request, reply, options, hostname, proxyRecord);
    }
  }

  let record;
  try {
    record = await options.resolver.resolveRedirect(hostname);
  } catch (error) {
    return sendResolverError(reply, error);
  }

  if (!record) {
    return reply.notFound();
  }

  const target = validateRedirectTarget(record, hostname);
  if (target instanceof Error) {
    const statusCode = target.message.includes("loops") ? 508 : 502;
    return reply.code(statusCode).send({
      statusCode,
      error: statusCode === 508 ? "Loop Detected" : "Bad Gateway",
      message: target.message
    });
  }

  return reply
    .code(redirectStatus(record, options.config.defaultStatus))
    .header("Location", target.toString())
    .send();
}

async function proxyRequest(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RouteOptions,
  hostname: string,
  record: ProxyRecord
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply
      .code(405)
      .header("Allow", "GET, HEAD")
      .send({ statusCode: 405, error: "Method Not Allowed", message: "PROXY only supports GET and HEAD" });
  }

  const targetBase = validateProxyTargetUrl(record.url, hostname, {
    allowPrivateTargets: options.config.proxyAllowPrivateTargets
  });
  if (targetBase instanceof Error) {
    return sendProxyTargetRejected(reply, targetBase);
  }

  const target = buildProxyUrl(targetBase, request.url);
  const redirectResult = await fetchProxyWithRedirects(request, options, target, hostname);
  if (redirectResult instanceof Error) {
    if (redirectResult.name === "AbortError") {
      return reply.code(504).send({ statusCode: 504, error: "Gateway Timeout", message: "Proxy upstream request timed out" });
    }
    if (redirectResult.message.startsWith("PROXY target rejected:")) {
      return sendProxyTargetRejected(reply, redirectResult);
    }
    if (redirectResult.message === "PROXY redirect limit exceeded") {
      return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: redirectResult.message });
    }
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream request failed" });
  }

  const contentLength = redirectResult.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.config.proxyMaxBodyBytes) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream response is too large" });
  }

  if (request.method === "HEAD") {
    copyProxyResponseHeaders(reply, redirectResult.headers);
    return reply
      .code(redirectResult.status)
      .header("x-vdns-proxy", "1")
      .header("x-vdns-proxy-target-host", redirectResult.url.hostname)
      .header("x-vdns-source-host", hostname)
      .send();
  }

  const body = Buffer.from(await redirectResult.response.arrayBuffer());
  if (body.byteLength > options.config.proxyMaxBodyBytes) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream response is too large" });
  }

  copyProxyResponseHeaders(reply, redirectResult.headers);
  return reply
    .code(redirectResult.status)
    .header("x-vdns-proxy", "1")
    .header("x-vdns-proxy-target-host", redirectResult.url.hostname)
    .header("x-vdns-source-host", hostname)
    .send(body);
}

type ProxyFetchResult = {
  response: Response;
  url: URL;
  status: number;
  headers: Headers;
};

async function fetchProxyWithRedirects(
  request: FastifyRequest,
  options: RouteOptions,
  initialTarget: string,
  hostname: string
): Promise<ProxyFetchResult | Error> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.proxyTimeoutMs);
  let target = new URL(initialTarget);

  try {
    for (let redirectCount = 0; redirectCount <= options.config.proxyMaxRedirects; redirectCount += 1) {
      const upstream = await (options.fetchImpl ?? fetch)(target.toString(), {
        method: request.method,
        headers: buildProxyRequestHeaders(request),
        redirect: "manual",
        signal: controller.signal
      });

      if (!isRedirectStatus(upstream.status)) {
        return { response: upstream, url: target, status: upstream.status, headers: upstream.headers };
      }

      const location = upstream.headers.get("location");
      if (!location) {
        return { response: upstream, url: target, status: upstream.status, headers: upstream.headers };
      }

      if (redirectCount >= options.config.proxyMaxRedirects) {
        return new Error("PROXY redirect limit exceeded");
      }

      let nextUrl: URL;
      try {
        nextUrl = new URL(location, target);
      } catch {
        return new Error("PROXY target rejected: redirect Location URL is invalid");
      }

      const nextTarget = validateProxyTargetUrl(nextUrl.toString(), hostname, {
        allowPrivateTargets: options.config.proxyAllowPrivateTargets
      });
      if (nextTarget instanceof Error) {
        return nextTarget;
      }
      target = nextTarget;
    }

    return new Error("PROXY redirect limit exceeded");
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return error;
    }
    return new Error("Proxy upstream request failed");
  } finally {
    clearTimeout(timeout);
  }
}

function buildProxyUrl(base: URL, requestUrl: string): string {
  const target = new URL(base.toString());
  const incoming = new URL(requestUrl, "http://vdns.local");
  const basePath = target.pathname.endsWith("/") ? target.pathname.slice(0, -1) : target.pathname;
  target.pathname = `${basePath}${incoming.pathname}`;
  target.search = incoming.search;
  target.hash = "";
  return target.toString();
}

function buildProxyRequestHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [name, rawValue] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (strippedRequestHeaders.has(lowerName) || rawValue === undefined) {
      continue;
    }
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    headers.set(name, value);
  }
  return headers;
}

function copyProxyResponseHeaders(reply: FastifyReply, headers: Headers): void {
  headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (strippedResponseHeaders.has(lowerName)) {
      return;
    }
    if (preservedResponseHeaders.has(lowerName) || (lowerName === "vary" && isSafeVaryHeader(value))) {
      reply.header(name, value);
    }
  });
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isSafeVaryHeader(value: string): boolean {
  if (value.trim() === "*") {
    return false;
  }

  const safeVaryHeaders = new Set(["accept", "accept-language", "user-agent"]);
  return value.split(",").every((part) => safeVaryHeaders.has(part.trim().toLowerCase()));
}

function sendProxyTargetRejected(reply: FastifyReply, error: Error) {
  const statusCode = error.message.includes("loops") ? 508 : 502;
  const reason = error.message.startsWith("PROXY target rejected:")
    ? error.message.slice("PROXY target rejected:".length).trim()
    : error.message;
  return reply.code(statusCode).send({
    statusCode,
    error: statusCode === 508 ? "Loop Detected" : "Bad Gateway",
    message: `PROXY target rejected: ${reason}`
  });
}

function sendResolverError(reply: FastifyReply, error: unknown) {
  if (error instanceof RedirectResolverError) {
    if (error.kind === "timeout") {
      return reply.code(504).send({ statusCode: 504, error: "Gateway Timeout", message: "VNS resolver request timed out" });
    }
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "VNS resolver upstream error" });
  }

  throw error;
}
