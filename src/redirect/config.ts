import { z } from "zod";
import { applyVdnsEnvCompatibility, envValue, envValueWithDefault } from "../envCompat.js";

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
  proxyMaxRedirects: number;
  proxyAllowPrivateTargets: boolean;
  httpsEnabled: boolean;
  httpsHost: string;
  httpsPort: number;
  tlsTld: string;
  tlsCaDir?: string | undefined;
  tlsCertDir?: string | undefined;
  tlsCertValidityDays: number;
  forceHttps: boolean;
  siteCacheEnabled: boolean;
  siteMaxFileBytes: number;
  siteMaxTotalManifestBytes: number;
  siteAllowFileUri: boolean;
};

const tldSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "must be a lowercase DNS label without a leading dot");

const intFromEnv = (name: string, value: string | undefined, fallback: number): number => {
  const raw = value ?? String(fallback);
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Invalid vDNS gateway configuration: ${name} must be an integer`);
  }
  return Number(raw);
};

const boolFromEnv = (value: string | undefined, fallback: boolean): boolean => {
  const raw = value ?? String(fallback);
  return raw.toLowerCase() === "true";
};

export function loadRedirectConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RedirectConfig {
  const resolvedEnv = applyVdnsEnvCompatibility({ ...env });
  const host = envValueWithDefault(resolvedEnv, "VDNS_GATEWAY_HOST", "VNS_REDIRECT_HOST", "127.0.0.1");
  const port = intFromEnv("VDNS_GATEWAY_PORT", envValue(resolvedEnv, "VDNS_GATEWAY_PORT", "VNS_REDIRECT_PORT"), 8081);
  const resolverUrl = envValueWithDefault(resolvedEnv, "VDNS_RESOLVER_URL", "VNS_RESOLVER_URL", "http://127.0.0.1:8080");
  const tld = envValueWithDefault(resolvedEnv, "VDNS_TLD", "VNS_TLD", "vdns");
  const defaultStatus = intFromEnv("VDNS_GATEWAY_DEFAULT_STATUS", envValue(resolvedEnv, "VDNS_GATEWAY_DEFAULT_STATUS", "VNS_REDIRECT_DEFAULT_STATUS"), 302);
  const timeoutMs = intFromEnv("VDNS_GATEWAY_TIMEOUT_MS", envValue(resolvedEnv, "VDNS_GATEWAY_TIMEOUT_MS", "VNS_REDIRECT_TIMEOUT_MS"), 5000);
  const proxyEnabled = boolFromEnv(env.VDNS_PROXY_ENABLED, false);
  const proxyTimeoutMs = intFromEnv("VDNS_PROXY_TIMEOUT_MS", env.VDNS_PROXY_TIMEOUT_MS, 10000);
  const proxyMaxBodyBytes = intFromEnv("VDNS_PROXY_MAX_BODY_BYTES", env.VDNS_PROXY_MAX_BODY_BYTES, 10485760);
  const proxyMaxRedirects = intFromEnv("VDNS_PROXY_MAX_REDIRECTS", env.VDNS_PROXY_MAX_REDIRECTS, 3);
  const proxyAllowPrivateTargets = boolFromEnv(env.VDNS_PROXY_ALLOW_PRIVATE_TARGETS, false);
  const httpsEnabled = boolFromEnv(env.VDNS_HTTPS_ENABLED, false);
  const httpsHost = env.VDNS_HTTPS_HOST ?? "127.0.0.1";
  const httpsPort = intFromEnv("VDNS_HTTPS_PORT", env.VDNS_HTTPS_PORT, 443);
  const tlsTld = env.VDNS_TLS_TLD ?? tld;
  const tlsCaDir = env.VDNS_TLS_CA_DIR;
  const tlsCertDir = env.VDNS_TLS_CERT_DIR;
  const tlsCertValidityDays = intFromEnv("VDNS_TLS_CERT_VALIDITY_DAYS", env.VDNS_TLS_CERT_VALIDITY_DAYS, 397);
  const forceHttps = boolFromEnv(env.VDNS_FORCE_HTTPS, false);
  const siteCacheEnabled = boolFromEnv(env.VDNS_SITE_CACHE_ENABLED, true);
  const siteMaxFileBytes = intFromEnv("VDNS_SITE_MAX_FILE_BYTES", env.VDNS_SITE_MAX_FILE_BYTES, 10485760);
  const siteMaxTotalManifestBytes = intFromEnv("VDNS_SITE_MAX_TOTAL_MANIFEST_BYTES", env.VDNS_SITE_MAX_TOTAL_MANIFEST_BYTES, 1048576);
  const siteAllowFileUri = boolFromEnv(env.VDNS_SITE_ALLOW_FILE_URI, false);

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
      proxyMaxRedirects: z.number().int().min(0).max(20),
      proxyAllowPrivateTargets: z.boolean(),
      httpsEnabled: z.boolean(),
      httpsHost: z.string().min(1),
      httpsPort: z.number().int().min(1).max(65535),
      tlsTld: tldSchema,
      tlsCaDir: z.string().min(1).optional(),
      tlsCertDir: z.string().min(1).optional(),
      tlsCertValidityDays: z.number().int().positive().max(397),
      forceHttps: z.boolean(),
      siteCacheEnabled: z.boolean(),
      siteMaxFileBytes: z.number().int().positive(),
      siteMaxTotalManifestBytes: z.number().int().positive(),
      siteAllowFileUri: z.boolean()
    })
    .safeParse({
      host,
      port,
      resolverUrl,
      tld,
      defaultStatus,
      timeoutMs,
      proxyEnabled,
      proxyTimeoutMs,
      proxyMaxBodyBytes,
      proxyMaxRedirects,
      proxyAllowPrivateTargets,
      httpsEnabled,
      httpsHost,
      httpsPort,
      tlsTld,
      tlsCaDir,
      tlsCertDir,
      tlsCertValidityDays,
      forceHttps,
      siteCacheEnabled,
      siteMaxFileBytes,
      siteMaxTotalManifestBytes,
      siteAllowFileUri
    });

  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid vDNS gateway configuration: ${message}`);
  }

  return parsed.data;
}
