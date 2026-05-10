import { isIP } from "node:net";

export type ProxyTargetValidationOptions = {
  allowPrivateTargets?: boolean;
};

export function validateProxyTargetUrl(
  input: string,
  requestedHost: string,
  options: ProxyTargetValidationOptions = {}
): URL | Error {
  if (!input.trim()) {
    return new Error("PROXY target URL is required");
  }

  let target: URL;
  try {
    target = new URL(input);
  } catch {
    return new Error("PROXY target URL is invalid");
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return new Error("PROXY target URL must use http or https");
  }

  const hostname = target.hostname.toLowerCase();
  if (!hostname) {
    return new Error("PROXY target URL host is required");
  }

  const normalizedRequestedHost = requestedHost.toLowerCase();
  if (hostname === normalizedRequestedHost || hostname.endsWith(`.${normalizedRequestedHost}`)) {
    return new Error("PROXY target loops to the requested host");
  }

  if (!options.allowPrivateTargets) {
    const privateReason = privateTargetReason(hostname);
    if (privateReason) {
      return new Error(privateReason);
    }
  }

  return target;
}

function privateTargetReason(hostname: string): string | null {
  const normalized = hostname.replace(/^\[(.*)\]$/, "$1");

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return "PROXY target rejected: localhost target is not allowed";
  }

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) {
    return isBlockedIpv4(normalized) ? "PROXY target rejected: private or reserved IPv4 target is not allowed" : null;
  }
  if (ipVersion === 6) {
    const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (ipv4Mapped) {
      return isBlockedIpv4(ipv4Mapped[1] ?? "")
        ? "PROXY target rejected: private or reserved IPv4 target is not allowed"
        : null;
    }
    return isBlockedIpv6(normalized) ? "PROXY target rejected: private or reserved IPv6 target is not allowed" : null;
  }

  return null;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [a = -1, b = -1] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("ff");
}
