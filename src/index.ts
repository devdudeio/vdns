import { loadConfigFromEnv } from "./config.js";
import { loadEnvFiles } from "./env.js";
import { buildServer } from "./api/server.js";
import { VnsResolver } from "./core/resolver.js";
import { MockVerusRpcClient } from "./rpc/mockVerusRpcClient.js";
import { VerusRpcClient } from "./rpc/verusRpcClient.js";

async function main(): Promise<void> {
  loadEnvFiles();
  const config = loadConfigFromEnv();
  logStartupConfig(config);
  const rpcClient = config.mode === "mock"
    ? new MockVerusRpcClient()
    : new VerusRpcClient({
      url: config.verusRpcUrl,
      user: config.verusRpcUser,
      password: config.verusRpcPassword,
      timeoutMs: config.verusRpcTimeoutMs
    });
  const resolver = new VnsResolver(config, rpcClient);
  const app = await buildServer(resolver, { logger: true });

  await app.listen({ port: config.port, host: "0.0.0.0" });
}

function logStartupConfig(config: ReturnType<typeof loadConfigFromEnv>): void {
  console.log("vDNS resolver starting");
  console.log(`mode: ${config.mode}`);
  console.log(`rootIdentity: ${config.rootIdentity}`);
  console.log(`tld: ${config.tld}`);
  console.log(`port: ${config.port}`);
  console.log(`rpcUrlConfigured: ${Boolean(config.verusRpcUrl)}`);
  console.log(`rpcUrlHost: ${parseUrlHost(config.verusRpcUrl) ?? "none"}`);
  console.log(`rpcAuthConfigured: ${Boolean(config.verusRpcUser || config.verusRpcPassword)}`);
  console.log(`rpcTimeoutMs: ${config.verusRpcTimeoutMs}`);

  if (config.mode === "mock") {
    console.warn("WARNING: VNS_MODE=mock uses local fixtures and does not read Verus chain data.");
  }
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
