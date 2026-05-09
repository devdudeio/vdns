import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RedirectConfig } from "./config.js";
import { isConfiguredTldHost, isLocalClient, normalizeHostHeader, redirectStatus, validateProxyTarget, validateRedirectTarget } from "./safety.js";
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

  app.get("/*", async (request, reply) => handleGatewayRequest(request, reply, options));
  app.head("/*", async (request, reply) => handleGatewayRequest(request, reply, options));
}

async function handleGatewayRequest(request: FastifyRequest, reply: FastifyReply, options: RouteOptions) {
  const hostname = normalizeHostHeader(request.headers.host);
  if (hostname instanceof Error) {
    return reply.badRequest(hostname.message);
  }

  if (!isConfiguredTldHost(hostname, options.config.tld)) {
    return reply.notFound();
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
  const targetBase = validateProxyTarget(record, hostname);
  if (targetBase instanceof Error) {
    const statusCode = targetBase.message.includes("loops") ? 508 : 502;
    return reply.code(statusCode).send({
      statusCode,
      error: statusCode === 508 ? "Loop Detected" : "Bad Gateway",
      message: targetBase.message
    });
  }

  const target = buildProxyUrl(targetBase, request.url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.config.proxyTimeoutMs);

  let upstream: Response;
  try {
    upstream = await (options.fetchImpl ?? fetch)(target, {
      method: request.method,
      headers: buildProxyRequestHeaders(request),
      redirect: options.config.proxyFollowRedirects,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return reply.code(504).send({ statusCode: 504, error: "Gateway Timeout", message: "Proxy upstream request timed out" });
    }
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream request failed" });
  } finally {
    clearTimeout(timeout);
  }

  copyProxyResponseHeaders(reply, upstream.headers);
  reply.code(upstream.status);

  if (request.method === "HEAD") {
    return reply.send();
  }

  const contentLength = upstream.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.config.proxyMaxBodyBytes) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream response is too large" });
  }

  const body = Buffer.from(await upstream.arrayBuffer());
  if (body.byteLength > options.config.proxyMaxBodyBytes) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "Proxy upstream response is too large" });
  }

  return reply.send(body);
}

function buildProxyUrl(base: URL, requestUrl: string): string {
  const target = new URL(base.toString());
  const incoming = new URL(requestUrl, "http://vdns.local");
  const basePath = target.pathname.endsWith("/") ? target.pathname.slice(0, -1) : target.pathname;
  target.pathname = `${basePath}${incoming.pathname}`.replace(/\/+/g, "/");
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
    if (!strippedResponseHeaders.has(name.toLowerCase())) {
      reply.header(name, value);
    }
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
