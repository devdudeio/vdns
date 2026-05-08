import sensible from "@fastify/sensible";
import Fastify from "fastify";
import type { VnsResolver } from "../core/resolver.js";
import { registerRoutes } from "./routes.js";

type ServerOptions = {
  logger?: boolean;
};

export async function buildServer(resolver: VnsResolver, options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  await app.register(sensible);
  await registerRoutes(app, resolver);
  return app;
}
