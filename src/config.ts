import { z } from "zod";
import { applyVdnsEnvCompatibility, envValue, envValueWithDefault } from "./envCompat.js";

export type VdnsConfig = {
  rootIdentity: string;
  tld: string;
  defaultTtl: number;
  mode: "mock" | "rpc";
  port: number;
  verusRpcUrl?: string | undefined;
  verusRpcUser?: string | undefined;
  verusRpcPassword?: string | undefined;
  verusRpcTimeoutMs: number;
};

export const DEFAULT_VERUS_READ_RPC_URL = "https://api.verustest.net/";

const tldSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be a lowercase DNS label without a leading dot");

const intFromEnv = (name: string, value: string | undefined, fallback: number): number => {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid vDNS configuration: ${name} must be an integer`);
  }
  return Number(raw);
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VdnsConfig {
  const resolvedEnv = applyVdnsEnvCompatibility({ ...env });
  const rootIdentity = envValueWithDefault(resolvedEnv, "VDNS_ROOT_IDENTITY", "VNS_ROOT_IDENTITY", "vdns@");
  const tld = envValueWithDefault(resolvedEnv, "VDNS_TLD", "VNS_TLD", "vdns");
  const defaultTtl = intFromEnv("VDNS_DEFAULT_TTL", envValue(resolvedEnv, "VDNS_DEFAULT_TTL", "VNS_DEFAULT_TTL"), 300);
  const mode = envValueWithDefault(resolvedEnv, "VDNS_MODE", "VNS_MODE", "rpc");
  const port = intFromEnv("PORT", env.PORT, 8080);
  const verusRpcTimeoutMs = intFromEnv("VERUS_RPC_TIMEOUT_MS", env.VERUS_RPC_TIMEOUT_MS, 10_000);
  const verusRpcUrl = mode === "rpc" ? (env.VERUS_RPC_URL ?? DEFAULT_VERUS_READ_RPC_URL) : env.VERUS_RPC_URL;

  const parsed = z
    .object({
      rootIdentity: z.string().min(1).refine((value) => value.endsWith("@"), "must end with @"),
      tld: tldSchema,
      defaultTtl: z.number().int().min(30).max(86400),
      mode: z.enum(["mock", "rpc"]),
      port: z.number().int().min(1).max(65535),
      verusRpcUrl: z.string().url().optional(),
      verusRpcUser: z.string().optional(),
      verusRpcPassword: z.string().optional(),
      verusRpcTimeoutMs: z.number().int().positive()
    })
    .safeParse({
      rootIdentity,
      tld,
      defaultTtl,
      mode,
      port,
      verusRpcUrl,
      verusRpcUser: env.VERUS_RPC_USER,
      verusRpcPassword: env.VERUS_RPC_PASSWORD,
      verusRpcTimeoutMs
    });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid vDNS configuration: ${message}`);
  }

  return parsed.data;
}
