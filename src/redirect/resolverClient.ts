import { z } from "zod";
import type { ResolveResult, VnsRecordType } from "../core/types.js";
import { selectProxyRecord, selectRedirectRecord, selectSiteRecord } from "./safety.js";
import { RedirectResolverError, type ProxyRecord, type RedirectRecord, type RedirectResolveDebug, type SiteRecord } from "./types.js";

type ResolverClientOptions = {
  resolverUrl: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
};

const resolveResultSchema = z.object({
  identity: z.string(),
  domain: z.string().optional(),
  host: z.string().optional(),
  records: z.array(z.unknown()),
  warnings: z.array(z.string())
});

export class HttpRedirectResolverClient {
  private readonly resolverUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: ResolverClientOptions) {
    this.resolverUrl = options.resolverUrl.replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async resolveRedirect(hostname: string): Promise<RedirectRecord | null> {
    const result = await this.fetchResolveResult(hostname, "REDIRECT");
    return result ? selectRedirectRecord(result.records) : null;
  }

  async resolveProxy(hostname: string): Promise<ProxyRecord | null> {
    const result = await this.fetchResolveResult(hostname, "PROXY");
    return result ? selectProxyRecord(result.records) : null;
  }

  async resolveSite(hostname: string): Promise<SiteRecord | null> {
    const result = await this.fetchResolveResult(hostname, "SITE");
    return result ? selectSiteRecord(result.records) : null;
  }

  async resolveDebug(hostname: string): Promise<RedirectResolveDebug> {
    const [redirectResult, proxyResult, siteResult] = await Promise.all([
      this.fetchResolveResult(hostname, "REDIRECT"),
      this.fetchResolveResult(hostname, "PROXY"),
      this.fetchResolveResult(hostname, "SITE")
    ]);
    return {
      hostname,
      resolverUrl: this.resolverUrl,
      result: redirectResult,
      selectedRecord: redirectResult ? selectRedirectRecord(redirectResult.records) : null,
      selectedProxyRecord: proxyResult ? selectProxyRecord(proxyResult.records) : null,
      selectedSiteRecord: siteResult ? selectSiteRecord(siteResult.records) : null
    };
  }

  private async fetchResolveResult(hostname: string, type: VnsRecordType): Promise<ResolveResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.resolverUrl}/resolve-domain/${encodeURIComponent(hostname)}?type=${type}`, {
        signal: controller.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new RedirectResolverError("timeout", `Resolver request timed out after ${this.timeoutMs}ms`);
      }
      throw new RedirectResolverError("upstream", "Resolver request failed");
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 404) {
      return null;
    }
    if (response.status >= 500) {
      throw new RedirectResolverError("upstream", `Resolver returned ${response.status}`);
    }
    if (!response.ok) {
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RedirectResolverError("invalid-response", "Resolver returned invalid JSON");
    }

    const parsed = resolveResultSchema.safeParse(body);
    if (!parsed.success) {
      throw new RedirectResolverError("invalid-response", "Resolver returned an invalid response shape");
    }

    return parsed.data as ResolveResult;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
