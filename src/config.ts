import { z } from "zod";

export type VnsConfig = {
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

const tldSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be a lowercase DNS label without a leading dot");

const intFromEnv = (name: string, value: string | undefined, fallback: number): number => {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid VNS configuration: ${name} must be an integer`);
  }
  return Number(raw);
};

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VnsConfig {
  const rootIdentity = env.VNS_ROOT_IDENTITY ?? "fum@";
  const tld = env.VNS_TLD ?? "vrsc";
  const defaultTtl = intFromEnv("VNS_DEFAULT_TTL", env.VNS_DEFAULT_TTL, 300);
  const mode = env.VNS_MODE ?? "rpc";
  const port = intFromEnv("PORT", env.PORT, 8080);
  const verusRpcTimeoutMs = intFromEnv("VERUS_RPC_TIMEOUT_MS", env.VERUS_RPC_TIMEOUT_MS, 10_000);

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
    .refine((value) => value.mode !== "rpc" || Boolean(value.verusRpcUrl), {
      path: ["verusRpcUrl"],
      message: "VERUS_RPC_URL is required when VNS_MODE=rpc. Use VNS_MODE=mock only for fixture/mock development."
    })
    .safeParse({
      rootIdentity,
      tld,
      defaultTtl,
      mode,
      port,
      verusRpcUrl: env.VERUS_RPC_URL,
      verusRpcUser: env.VERUS_RPC_USER,
      verusRpcPassword: env.VERUS_RPC_PASSWORD,
      verusRpcTimeoutMs
    });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid VNS configuration: ${message}`);
  }

  return parsed.data;
}
