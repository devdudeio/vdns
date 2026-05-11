import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readFile } from "node:fs/promises";
import type { TLSSocket } from "node:tls";
import type { RedirectConfig } from "./config.js";
import { validateProxyTargetUrl } from "./proxySecurity.js";
import { isConfiguredTldHost, isLocalClient, normalizeHostHeader, redirectStatus, validateRedirectTarget } from "./safety.js";
import { RedirectResolverError, type ProxyRecord, type RedirectResolverClient, type SiteRecord } from "./types.js";
import { sha256Hex, validateSiteManifest, type VdnsSiteManifest } from "../core/site.js";
import { vdnsTlsHostMatches } from "../tls/hosts.js";

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

  const servername = (request.socket as TLSSocket).servername;
  if (request.protocol === "https" && !vdnsTlsHostMatches(hostname, typeof servername === "string" ? servername : undefined, options.config.tlsTld)) {
    return reply.code(421).send({
      statusCode: 421,
      error: "Misdirected Request",
      message: "HTTPS Host header does not match TLS SNI"
    });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return reply
      .code(405)
      .header("Allow", "GET, HEAD")
      .send({ statusCode: 405, error: "Method Not Allowed", message: "Web gateway only supports GET and HEAD" });
  }

  if (request.protocol === "http" && options.config.forceHttps) {
    return reply
      .code(302)
      .header("Location", `https://${hostname}${request.url}`)
      .send();
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

  if (record) {
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

  let siteRecord: SiteRecord | null = null;
  try {
    siteRecord = options.resolver.resolveSite ? await options.resolver.resolveSite(hostname) : null;
  } catch (error) {
    return sendResolverError(reply, error);
  }

  if (!siteRecord) {
    return reply.notFound();
  }

  return serveSite(request, reply, options, hostname, siteRecord);
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

async function serveSite(
  request: FastifyRequest,
  reply: FastifyReply,
  options: RouteOptions,
  hostname: string,
  record: SiteRecord
) {
  const manifestResult = await loadGatewaySiteManifest(record, hostname, options);
  if (manifestResult instanceof Error) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: manifestResult.message });
  }

  const manifest = manifestResult;
  const requestedPath = normalizeSiteRequestPath(request.url);
  if (requestedPath instanceof Error) {
    return reply.badRequest(requestedPath.message);
  }

  const selectedPath = requestedPath === "/" ? manifest.entry : requestedPath;
  const file = manifest.files.find((candidate) => candidate.path === selectedPath)
    ?? (manifest.spaFallback ? manifest.files.find((candidate) => candidate.path === manifest.entry) : undefined);
  if (!file) {
    return reply.notFound();
  }
  if (file.size > options.config.siteMaxFileBytes) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "SITE file is too large" });
  }

  const fileBody = await fetchSiteBytes(file.uri, hostname, options, options.config.siteMaxFileBytes);
  if (fileBody instanceof Error) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: fileBody.message });
  }
  if (sha256Hex(fileBody) !== file.sha256) {
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "SITE file hash mismatch" });
  }

  reply
    .code(200)
    .header("content-type", file.mime)
    .header("cache-control", `public, max-age=${record.ttl}`)
    .header("x-vdns-site", "1")
    .header("x-vdns-site-entry", manifest.entry)
    .header("x-vdns-source-host", hostname);

  return request.method === "HEAD" ? reply.send() : reply.send(fileBody);
}

async function loadGatewaySiteManifest(
  record: SiteRecord,
  hostname: string,
  options: RouteOptions
): Promise<VdnsSiteManifest | Error> {
  const body = await fetchSiteBytes(record.manifestUri, hostname, options, options.config.siteMaxTotalManifestBytes);
  if (body instanceof Error) {
    return body;
  }
  if (record.sha256 && sha256Hex(body) !== record.sha256) {
    return new Error("SITE manifest hash mismatch");
  }
  try {
    return validateSiteManifest(JSON.parse(body.toString("utf8")));
  } catch (error) {
    return new Error(`SITE manifest invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

async function fetchSiteBytes(
  uri: string,
  hostname: string,
  options: RouteOptions,
  maxBytes: number
): Promise<Buffer | Error> {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return new Error("SITE URI is invalid");
  }

  if (url.protocol === "file:") {
    if (!options.config.siteAllowFileUri) {
      return new Error("SITE file:// URI is disabled");
    }
    const body = await readFile(url);
    return body.byteLength > maxBytes ? new Error("SITE response is too large") : body;
  }

  const target = validateProxyTargetUrl(uri, hostname, {
    allowPrivateTargets: options.config.proxyAllowPrivateTargets
  });
  if (target instanceof Error) {
    return target;
  }

  const response = await (options.fetchImpl ?? fetch)(target.toString(), { redirect: "manual" });
  if (!response.ok) {
    return new Error(`SITE fetch failed with HTTP ${response.status}`);
  }
  const length = response.headers.get("content-length");
  if (length && Number(length) > maxBytes) {
    return new Error("SITE response is too large");
  }
  const body = Buffer.from(await response.arrayBuffer());
  return body.byteLength > maxBytes ? new Error("SITE response is too large") : body;
}

function normalizeSiteRequestPath(requestUrl: string): string | Error {
  const url = new URL(requestUrl, "http://vdns.local");
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Error("Invalid request path");
  }
  if (!pathname.startsWith("/") || pathname.includes("\\") || pathname.split("/").includes("..")) {
    return new Error("Invalid request path");
  }
  return pathname;
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
