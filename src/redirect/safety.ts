import { isIP } from "node:net";
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
  const target = validateHttpTarget(record.url, requestedHostname, "Proxy");
  if (target instanceof Error) {
    return target;
  }

  if (isExplicitLocalOrPrivateHost(target.hostname)) {
    return new Error("Proxy target URL must not use localhost or a private address");
  }

  return target;
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

function isExplicitLocalOrPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return true;
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isPrivateIpv4(normalized);
  }
  if (ipVersion === 6) {
    const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4Mapped) { return isPrivateIpv4(ipv4Mapped[1] ?? ""); }
    return isPrivateIpv6(normalized);
  }

  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  const a = octets[0] ?? -1;
  const b = octets[1] ?? -1;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 0) ||
    (a === 100 && b >= 64 && b <= 127);
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:");
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
