import type { ResolveResult, VnsRecord } from "../core/types.js";

export type RedirectRecord = Extract<VnsRecord, { type: "REDIRECT" }>;
export type ProxyRecord = Extract<VnsRecord, { type: "PROXY" }>;
export type SiteRecord = Extract<VnsRecord, { type: "SITE" }>;

export type RedirectResolverErrorKind = "upstream" | "timeout" | "invalid-response";

export class RedirectResolverError extends Error {
  constructor(readonly kind: RedirectResolverErrorKind, message: string) {
    super(message);
    this.name = "RedirectResolverError";
  }
}

export type RedirectResolverClient = {
  resolveRedirect(hostname: string): Promise<RedirectRecord | null>;
  resolveProxy?(hostname: string): Promise<ProxyRecord | null>;
  resolveSite?(hostname: string): Promise<SiteRecord | null>;
};

export type RedirectResolveDebug = {
  hostname: string;
  resolverUrl: string;
  result: ResolveResult | null;
  selectedRecord: RedirectRecord | null;
  selectedProxyRecord?: ProxyRecord | null;
  selectedSiteRecord?: SiteRecord | null;
};
