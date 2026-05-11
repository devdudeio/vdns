import type { VdnsConfig } from "../config.js";

const labelPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type ParsedVdnsDomain = {
  domain: string;
  identity: string;
  host: string;
};

export function parseVdnsDomain(domain: string, config: VdnsConfig): ParsedVdnsDomain {
  const normalized = domain.trim().replace(/\.$/, "").toLowerCase();
  if (normalized.length === 0) {
    throw new Error("Domain is required");
  }

  const labels = normalized.split(".");
  if (labels.some((label) => label.length === 0)) {
    throw new Error(`Invalid domain: ${domain}`);
  }

  if (labels.at(-1) !== config.tld) {
    throw new Error(`Domain must end with .${config.tld}`);
  }

  if (labels.length !== 2 && labels.length !== 3) {
    throw new Error(`vDNS v1 supports only name.${config.tld} or host.name.${config.tld}`);
  }

  const relevantLabels = labels.slice(0, -1);
  if (!relevantLabels.every((label) => labelPattern.test(label))) {
    throw new Error(`Invalid vDNS domain label in ${domain}`);
  }

  const name = labels.length === 2 ? labels[0] : labels[1];
  const host = labels.length === 2 ? "@" : labels[0];
  if (!name || !host) {
    throw new Error(`Invalid domain: ${domain}`);
  }

  return {
    domain: normalized,
    identity: `${name}.${config.rootIdentity}`,
    host
  };
}
