import { loadEnvFiles } from "./env.js";
import { loadRedirectConfigFromEnv } from "./redirect/config.js";
import { buildRedirectServer } from "./redirect/server.js";

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadRedirectConfigFromEnv();
  logStartupConfig(config);

  const app = await buildRedirectServer(config, { logger: true });
  await app.listen({ port: config.port, host: config.host });
  console.log(`VNS redirect service listening on ${config.host}:${config.port}`);
}

function logStartupConfig(config: ReturnType<typeof loadRedirectConfigFromEnv>): void {
  console.log("VNS redirect service starting");
  console.log(`host: ${config.host}`);
  console.log(`port: ${config.port}`);
  console.log(`tld: ${config.tld}`);
  console.log(`resolverUrl: ${config.resolverUrl}`);
  console.log(`defaultStatus: ${config.defaultStatus}`);
  console.log(`timeoutMs: ${config.timeoutMs}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
