import type { FastifyInstance, FastifyReply } from "fastify";
import { isRecordType } from "../core/records.js";
import { IdentityNotFoundError, type VdnsResolver } from "../core/resolver.js";
import type { VdnsRecordType } from "../core/types.js";
import { VerusRpcError } from "../rpc/verusRpcClient.js";

type TypeQuery = {
  type?: string;
};

export async function registerRoutes(app: FastifyInstance, resolver: VdnsResolver): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));

  app.get("/debug/config", async () => {
    const config = resolver.getConfig();
    return {
      mode: config.mode,
      rootIdentity: config.rootIdentity,
      tld: config.tld,
      defaultTtl: config.defaultTtl,
      port: config.port,
      rpcUrlConfigured: Boolean(config.verusRpcUrl),
      rpcUrlHost: parseUrlHost(config.verusRpcUrl),
      rpcAuthConfigured: Boolean(config.verusRpcUser || config.verusRpcPassword),
      rpcTimeoutMs: config.verusRpcTimeoutMs
    };
  });

  app.get<{ Params: { identity: string } }>("/debug/raw-identity/:identity", async (request, reply) => {
    try {
      const raw = await resolver.getRawIdentity(request.params.identity);
      if (raw === null) {
        return reply.notFound(`Identity not found: ${request.params.identity}`);
      }
      return raw;
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });

  app.get("/debug/rpc-health", async (_request, reply) => {
    try {
      return await resolver.getRpcHealth();
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });

  app.get("/debug/vdxf-keys", async (_request, reply) => {
    try {
      return await resolver.getDebugVdxfKeys();
    } catch (error) {
      return sendUpstreamError(reply, error);
    }
  });

  app.get<{ Params: { identity: string }; Querystring: TypeQuery }>("/resolve/:identity", async (request, reply) => {
    const typeFilter = parseTypeFilter(request.query.type);
    if (typeFilter instanceof Error) {
      return reply.badRequest(typeFilter.message);
    }

    try {
      return await resolver.resolveIdentity(request.params.identity, typeFilter);
    } catch (error) {
      if (error instanceof IdentityNotFoundError) {
        return sendIdentityNotFound(reply, resolver, error);
      }
      return sendUpstreamError(reply, error);
    }
  });

  app.get<{ Params: { domain: string }; Querystring: TypeQuery }>("/resolve-domain/:domain", async (request, reply) => {
    const typeFilter = parseTypeFilter(request.query.type);
    if (typeFilter instanceof Error) {
      return reply.badRequest(typeFilter.message);
    }

    try {
      return await resolver.resolveDomain(request.params.domain, typeFilter);
    } catch (error) {
      if (error instanceof IdentityNotFoundError) {
        return sendIdentityNotFound(reply, resolver, error);
      }
      if (error instanceof VerusRpcError) {
        return sendUpstreamError(reply, error);
      }
      const message = error instanceof Error ? error.message : "Invalid domain";
      return reply.badRequest(message);
    }
  });
}

function sendIdentityNotFound(reply: FastifyReply, resolver: VdnsResolver, error: IdentityNotFoundError) {
  const config = resolver.getConfig();
  return reply.code(404).send({
    statusCode: 404,
    error: "Not Found",
    message: error.message,
    details: {
      mode: config.mode,
      rootIdentity: config.rootIdentity,
      tld: config.tld
    }
  });
}

function parseTypeFilter(type: string | undefined): VdnsRecordType | undefined | Error {
  if (!type) {
    return undefined;
  }

  if (!isRecordType(type)) {
    return new Error(`Unsupported record type: ${type}`);
  }

  return type;
}

function parseUrlHost(url: string | undefined): string | null {
  if (!url) {
    return null;
  }

  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function sendUpstreamError(reply: FastifyReply, error: unknown) {
  if (error instanceof VerusRpcError) {
    const message = error.kind === "timeout" ? "Verus RPC request timed out" : "Verus RPC upstream error";
    if (error.kind === "timeout") {
      return reply.code(504).send({ statusCode: 504, error: "Gateway Timeout", message });
    }
    return reply.code(502).send({ statusCode: 502, error: "Bad Gateway", message });
  }

  throw error;
}
