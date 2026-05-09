import sensible from "@fastify/sensible";
import Fastify from "fastify";
import type { RedirectConfig } from "./config.js";
import { HttpRedirectResolverClient } from "./resolverClient.js";
import { registerRedirectRoutes } from "./routes.js";
import type { RedirectResolverClient } from "./types.js";

type ServerOptions = {
  logger?: boolean;
  resolver?: RedirectResolverClient;
  fetchImpl?: typeof fetch;
};

export async function buildRedirectServer(config: RedirectConfig, options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, exposeHeadRoutes: false });
  const resolver = options.resolver ?? new HttpRedirectResolverClient({
    resolverUrl: config.resolverUrl,
    timeoutMs: config.timeoutMs
  });

  await app.register(sensible);
  await registerRedirectRoutes(app, {
    config,
    resolver,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {})
  });
  return app;
}
