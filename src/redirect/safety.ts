import { validateProxyTargetUrl } from "./proxySecurity.js";
import type { ProxyRecord, RedirectRecord } from "./types.js";

const hostnamePattern = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeHostHeader(hostHeader: string | undefined): string | Error {
  if (!hostHeader) {
    return new Error("Host header is required");
  }

  const hostname = stripOptionalPort(hostHeader.trim().toLowerCase());
  if (!hostname || !hostnamePattern.test(hostname)) {
    return new Error("Invalid Host header");
  }

  return hostname;
}

export function isConfiguredTldHost(hostname: string, tld: string): boolean {
  return hostname.endsWith(`.${tld}`);
}

export function selectRedirectRecord(records: unknown): RedirectRecord | null {
  if (!Array.isArray(records)) {
    return null;
  }

  return records.find((record): record is RedirectRecord =>
    Boolean(record) &&
    typeof record === "object" &&
    (record as { type?: unknown }).type === "REDIRECT" &&
    (record as { name?: unknown }).name === "@" &&
    typeof (record as { url?: unknown }).url === "string"
  ) ?? null;
}

export function selectProxyRecord(records: unknown): ProxyRecord | null {
  if (!Array.isArray(records)) {
    return null;
  }

  return records.find((record): record is ProxyRecord =>
    Boolean(record) &&
    typeof record === "object" &&
    (record as { type?: unknown }).type === "PROXY" &&
    (record as { name?: unknown }).name === "@" &&
    typeof (record as { url?: unknown }).url === "string"
  ) ?? null;
}

export function validateRedirectTarget(record: RedirectRecord, requestedHostname: string): URL | Error {
  return validateHttpTarget(record.url, requestedHostname, "Redirect");
}

export function validateProxyTarget(record: ProxyRecord, requestedHostname: string): URL | Error {
  return validateProxyTargetUrl(record.url, requestedHostname);
}

export function redirectStatus(record: RedirectRecord, defaultStatus: 301 | 302): 301 | 302 {
  return record.status === 301 || record.status === 302 ? record.status : defaultStatus;
}

export function isLocalClient(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function validateHttpTarget(url: string, requestedHostname: string, label: "Redirect" | "Proxy"): URL | Error {
  if (!url.trim()) {
    return new Error(`${label} target URL is required`);
  }

  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return new Error(`${label} target URL is invalid`);
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Error(`${label} target URL must use http or https`);
  }

  if (target.hostname.toLowerCase() === requestedHostname) {
    return new Error(`${label} target loops to the requested host`);
  }

  return target;
}

function stripOptionalPort(host: string): string {
  if (host.startsWith("[")) {
    return "";
  }

  const colonIndex = host.lastIndexOf(":");
  if (colonIndex === -1) {
    return host;
  }

  const port = host.slice(colonIndex + 1);
  if (/^\d+$/.test(port)) {
    return host.slice(0, colonIndex);
  }

  return host;
}
