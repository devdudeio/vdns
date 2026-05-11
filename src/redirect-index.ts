import { loadEnvFiles } from "./env.js";
import { loadRedirectConfigFromEnv } from "./redirect/config.js";
import { buildHttpsRedirectServer, buildRedirectServer } from "./redirect/server.js";
import { caStatus } from "./tls/certs.js";
import { deriveTlsPaths } from "./tls/paths.js";

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadRedirectConfigFromEnv();
  logStartupConfig(config);

  const app = await buildRedirectServer(config, { logger: true });
  await app.listen({ port: config.port, host: config.host });
  console.log(`vDNS gateway listening on ${config.host}:${config.port}`);

  if (config.httpsEnabled) {
    const tlsPaths = deriveTlsPaths({
      ...process.env,
      ...(config.tlsCaDir ? { VDNS_TLS_CA_DIR: config.tlsCaDir } : {}),
      ...(config.tlsCertDir ? { VDNS_TLS_CERT_DIR: config.tlsCertDir } : {})
    });
    const status = await caStatus(tlsPaths);
    if (!status.caCertExists || !status.caKeyExists) {
      throw new Error("VDNS_HTTPS_ENABLED=true requires a local CA. Run: vdns https init-ca");
    }
    const httpsApp = await buildHttpsRedirectServer(config, { logger: true });
    await httpsApp.listen({ port: config.httpsPort, host: config.httpsHost });
    console.log(`vDNS HTTPS gateway listening on ${config.httpsHost}:${config.httpsPort}`);
  }
}

function logStartupConfig(config: ReturnType<typeof loadRedirectConfigFromEnv>): void {
  console.log("vDNS gateway starting");
  console.log(`host: ${config.host}`);
  console.log(`port: ${config.port}`);
  console.log(`tld: ${config.tld}`);
  console.log(`resolverUrl: ${config.resolverUrl}`);
  console.log(`defaultStatus: ${config.defaultStatus}`);
  console.log(`timeoutMs: ${config.timeoutMs}`);
  console.log(`proxyEnabled: ${config.proxyEnabled}`);
  console.log(`proxyTimeoutMs: ${config.proxyTimeoutMs}`);
  console.log(`proxyMaxBodyBytes: ${config.proxyMaxBodyBytes}`);
  console.log(`proxyMaxRedirects: ${config.proxyMaxRedirects}`);
  console.log(`proxyAllowPrivateTargets: ${config.proxyAllowPrivateTargets}`);
  console.log(`httpsEnabled: ${config.httpsEnabled}`);
  console.log(`httpsHost: ${config.httpsHost}`);
  console.log(`httpsPort: ${config.httpsPort}`);
  console.log(`tlsTld: ${config.tlsTld}`);
  console.log(`forceHttps: ${config.forceHttps}`);
  console.log(`siteCacheEnabled: ${config.siteCacheEnabled}`);
  console.log(`siteMaxFileBytes: ${config.siteMaxFileBytes}`);
  console.log(`siteMaxTotalManifestBytes: ${config.siteMaxTotalManifestBytes}`);
  console.log(`siteAllowFileUri: ${config.siteAllowFileUri}`);
  if (config.proxyAllowPrivateTargets) {
    console.warn("WARNING: VDNS_PROXY_ALLOW_PRIVATE_TARGETS=true disables PROXY private/internal target rejection.");
  }
  if (config.forceHttps) {
    console.warn("WARNING: VDNS_FORCE_HTTPS=true is experimental and redirects HTTP vDNS requests to HTTPS.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
