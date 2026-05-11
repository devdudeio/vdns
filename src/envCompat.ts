export function envValue(env: NodeJS.ProcessEnv, primary: string, legacy?: string): string | undefined {
  return env[primary] ?? (legacy ? env[legacy] : undefined);
}

export function envValueWithDefault(env: NodeJS.ProcessEnv, primary: string, legacy: string | undefined, fallback: string): string {
  return envValue(env, primary, legacy) ?? fallback;
}

export function applyVdnsEnvCompatibility(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const pairs: Array<[primary: string, legacy: string]> = [
    ["VDNS_MODE", "VNS_MODE"],
    ["VDNS_ROOT_IDENTITY", "VNS_ROOT_IDENTITY"],
    ["VDNS_TLD", "VNS_TLD"],
    ["VDNS_DEFAULT_TTL", "VNS_DEFAULT_TTL"],
    ["VDNS_RESOLVER_URL", "VNS_RESOLVER_URL"],
    ["VDNS_DNS_PORT", "VNS_DNS_PORT"],
    ["VDNS_GATEWAY_HOST", "VNS_REDIRECT_HOST"],
    ["VDNS_GATEWAY_PORT", "VNS_REDIRECT_PORT"],
    ["VDNS_GATEWAY_DEFAULT_STATUS", "VNS_REDIRECT_DEFAULT_STATUS"],
    ["VDNS_GATEWAY_TIMEOUT_MS", "VNS_REDIRECT_TIMEOUT_MS"]
  ];

  for (const [primary, legacy] of pairs) {
    if (env[primary] === undefined && env[legacy] !== undefined) {
      env[primary] = env[legacy];
    }
  }
  return env;
}
