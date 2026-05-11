import sensible from "@fastify/sensible";
import Fastify from "fastify";
import tls from "node:tls";
import { readFile } from "node:fs/promises";
import type { RedirectConfig } from "./config.js";
import { HttpRedirectResolverClient } from "./resolverClient.js";
import { registerRedirectRoutes } from "./routes.js";
import type { RedirectResolverClient } from "./types.js";
import { generateHostCert } from "../tls/certs.js";
import { normalizeVdnsTlsHost } from "../tls/hosts.js";
import { deriveTlsPaths, hostCertPaths } from "../tls/paths.js";

type ServerOptions = {
  logger?: boolean;
  resolver?: RedirectResolverClient;
  fetchImpl?: typeof fetch;
};

export async function buildRedirectServer(config: RedirectConfig, options: ServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, exposeHeadRoutes: false });
  await registerCommon(app, config, options);
  return app;
}

export async function buildHttpsRedirectServer(config: RedirectConfig, options: ServerOptions = {}) {
  const paths = deriveTlsPaths(tlsEnv(config));
  const defaultHost = `verus.${config.tlsTld}`;
  await generateHostCert(defaultHost, {
    tld: config.tlsTld,
    validityDays: config.tlsCertValidityDays,
    paths
  });
  const defaultCert = hostCertPaths(paths, defaultHost);
  const app = Fastify({
    logger: options.logger ?? false,
    exposeHeadRoutes: false,
    https: {
      cert: await readFile(defaultCert.cert),
      key: await readFile(defaultCert.key),
      SNICallback: (servername, callback) => {
        void loadSniContext(servername, config)
          .then((context) => callback(null, context))
          .catch((error) => callback(error));
      }
    }
  });
  await registerCommon(app, config, options);
  return app;
}

async function registerCommon(app: Awaited<ReturnType<typeof Fastify>>, config: RedirectConfig, options: ServerOptions): Promise<void> {
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
}

async function loadSniContext(servername: string, config: RedirectConfig): Promise<tls.SecureContext> {
  const hostname = normalizeVdnsTlsHost(servername, config.tlsTld);
  if (hostname instanceof Error) {
    throw hostname;
  }
  const paths = deriveTlsPaths(tlsEnv(config));
  const generated = await generateHostCert(hostname, {
    tld: config.tlsTld,
    validityDays: config.tlsCertValidityDays,
    paths
  });
  return tls.createSecureContext({
    cert: await readFile(generated.cert),
    key: await readFile(generated.key)
  });
}

function tlsEnv(config: RedirectConfig): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...(config.tlsCaDir ? { VDNS_TLS_CA_DIR: config.tlsCaDir } : {}),
    ...(config.tlsCertDir ? { VDNS_TLS_CERT_DIR: config.tlsCertDir } : {})
  };
}
