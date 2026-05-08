import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RedirectConfig } from "./config.js";
import { isConfiguredTldHost, isLocalClient, normalizeHostHeader, redirectStatus, validateRedirectTarget } from "./safety.js";
import { RedirectResolverError, type RedirectResolverClient } from "./types.js";

type DebugResolveQuery = {
  host?: string;
};

type RouteOptions = {
  config: RedirectConfig;
  resolver: RedirectResolverClient;
};

type DebugCapableResolver = RedirectResolverClient & {
  resolveDebug?(hostname: string): Promise<unknown>;
};

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
        selectedRecord: await resolver.resolveRedirect(hostname)
      };
    } catch (error) {
      return sendResolverError(reply, error);
    }
  });

  app.get("/*", async (request, reply) => handleRedirectRequest(request, reply, options));
  app.head("/*", async (request, reply) => handleRedirectRequest(request, reply, options));
}

async function handleRedirectRequest(request: FastifyRequest, reply: FastifyReply, options: RouteOptions) {
  const hostname = normalizeHostHeader(request.headers.host);
  if (hostname instanceof Error) {
    return reply.badRequest(hostname.message);
  }

  if (!isConfiguredTldHost(hostname, options.config.tld)) {
    return reply.notFound();
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

function sendResolverError(reply: FastifyReply, error: unknown) {
  if (error instanceof RedirectResolverError) {
    if (error.kind === "timeout") {
      return reply.code(504).send({ statusCode: 504, error: "Gateway Timeout", message: "VNS resolver request timed out" });
    }
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message: "VNS resolver upstream error" });
  }

  throw error;
}
