import net from "node:net";

const hostnamePattern = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function normalizeVdnsTlsHost(host: string, tld: string): string | Error {
  const hostname = host.trim().toLowerCase();
  if (
    !hostname ||
    hostname.includes("/") ||
    hostname.includes("\\") ||
    hostname.includes(":") ||
    /\s/.test(hostname) ||
    net.isIP(hostname) !== 0 ||
    hostname === "localhost" ||
    !hostnamePattern.test(hostname)
  ) {
    return new Error("Invalid vDNS TLS host");
  }
  if (!hostname.endsWith(`.${tld}`)) {
    return new Error(`Host must end in .${tld}`);
  }
  return hostname;
}

export function vdnsTlsHostMatches(hostname: string, servername: string | undefined, tld: string): boolean {
  if (!servername) {
    return false;
  }
  const normalizedSni = normalizeVdnsTlsHost(servername, tld);
  return !(normalizedSni instanceof Error) && normalizedSni === hostname;
}
