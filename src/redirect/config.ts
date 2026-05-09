import { z } from "zod";

export type RedirectConfig = {
  host: string;
  port: number;
  resolverUrl: string;
  tld: string;
  defaultStatus: 301 | 302;
  timeoutMs: number;
  proxyEnabled: boolean;
  proxyTimeoutMs: number;
  proxyMaxBodyBytes: number;
  proxyFollowRedirects: "manual";
};

const tldSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be a lowercase DNS label without a leading dot");

const intFromEnv = (name: string, value: string | undefined, fallback: number): number => {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid VNS redirect configuration: ${name} must be an integer`);
  }
  return Number(raw);
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  const raw = value ?? String(fallback);
  return raw.toLowerCase() === "true";
};

export function loadRedirectConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RedirectConfig {
  const host = env.VNS_REDIRECT_HOST ?? "127.0.0.1";
  const port = intFromEnv("VNS_REDIRECT_PORT", env.VNS_REDIRECT_PORT, 8081);
  const resolverUrl = env.VNS_RESOLVER_URL ?? "http://127.0.0.1:8080";
  const tld = env.VNS_TLD ?? "vrsc";
  const defaultStatus = intFromEnv("VNS_REDIRECT_DEFAULT_STATUS", env.VNS_REDIRECT_DEFAULT_STATUS, 302);
  const timeoutMs = intFromEnv("VNS_REDIRECT_TIMEOUT_MS", env.VNS_REDIRECT_TIMEOUT_MS, 5000);
  const proxyEnabled = boolFromEnv(env.VDNS_PROXY_ENABLED, false);
  const proxyTimeoutMs = intFromEnv("VDNS_PROXY_TIMEOUT_MS", env.VDNS_PROXY_TIMEOUT_MS, 10000);
  const proxyMaxBodyBytes = intFromEnv("VDNS_PROXY_MAX_BODY_BYTES", env.VDNS_PROXY_MAX_BODY_BYTES, 10485760);
  const proxyFollowRedirects = env.VDNS_PROXY_FOLLOW_REDIRECTS ?? "manual";

  const parsed = z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      resolverUrl: z.string().url(),
      tld: tldSchema,
      defaultStatus: z.union([z.literal(301), z.literal(302)]),
      timeoutMs: z.number().int().positive(),
      proxyEnabled: z.boolean(),
      proxyTimeoutMs: z.number().int().positive(),
      proxyMaxBodyBytes: z.number().int().positive(),
      proxyFollowRedirects: z.literal("manual")
    })
    .safeParse({ host, port, resolverUrl, tld, defaultStatus, timeoutMs, proxyEnabled, proxyTimeoutMs, proxyMaxBodyBytes, proxyFollowRedirects });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid VNS redirect configuration: ${message}`);
  }

  return parsed.data;
}
