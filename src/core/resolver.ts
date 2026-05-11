import type { VdnsConfig } from "../config.js";
import { parseVdnsDomain } from "./domain.js";
import { parseIdentityRecords } from "./parser.js";
import { filterRecordsForHostAndType } from "./records.js";
import type { IdentityPayload, ResolveResult, VerusRpcLike, VdnsRecord, VdnsRecordType } from "./types.js";
import { TtlCache } from "./cache.js";
import { buildVdnsVdxfKeyNames, resolveVdnsVdxfIds, type VdnsVdxfIds, type VdnsVdxfKeyNames } from "./vdxf.js";

type CachedParsedIdentity = {
  records: VdnsRecord[];
  warnings: string[];
};

export type DebugVdxfKeys = {
  rootIdentity: string;
  tld: string;
  keys: {
    record: { name: string; vdxfid: string };
    dnsA: { name: string; vdxfid: string };
    dnsAAAA: { name: string; vdxfid: string };
    dnsCNAME: { name: string; vdxfid: string };
    dnsTXT: { name: string; vdxfid: string };
    webRedirect: { name: string; vdxfid: string };
    webProxy: { name: string; vdxfid: string };
    webSite: { name: string; vdxfid: string };
    tlsFingerprint: { name: string; vdxfid: string };
  };
};

export class IdentityNotFoundError extends Error {
  constructor(readonly identity: string) {
    super(`Identity not found: ${identity}`);
    this.name = "IdentityNotFoundError";
  }
}

export class VdnsResolver {
  private static readonly vdxfIdsCache = new Map<string, Promise<VdnsVdxfIds>>();
  private readonly cache: TtlCache<CachedParsedIdentity>;

  constructor(
    private readonly config: VdnsConfig,
    private readonly rpcClient: VerusRpcLike,
    cache?: TtlCache<CachedParsedIdentity>
  ) {
    this.cache = cache ?? new TtlCache<CachedParsedIdentity>();
  }

  async resolveIdentity(identity: string, typeFilter?: VdnsRecordType): Promise<ResolveResult> {
    const parsed = await this.getParsedIdentity(identity);
    return {
      identity,
      records: parsed.records.filter((record) => !typeFilter || record.type === typeFilter),
      warnings: parsed.warnings
    };
  }

  getConfig(): VdnsConfig {
    return this.config;
  }

  async getDebugVdxfKeys(): Promise<DebugVdxfKeys> {
    const keyNames = this.getVdxfKeyNames();
    const ids = await this.getVdxfIds();
    return {
      rootIdentity: this.config.rootIdentity,
      tld: this.config.tld,
      keys: {
        record: { name: keyNames.record, vdxfid: ids.record },
        dnsA: { name: keyNames.labels.A, vdxfid: ids.labels.A },
        dnsAAAA: { name: keyNames.labels.AAAA, vdxfid: ids.labels.AAAA },
        dnsCNAME: { name: keyNames.labels.CNAME, vdxfid: ids.labels.CNAME },
        dnsTXT: { name: keyNames.labels.TXT, vdxfid: ids.labels.TXT },
        webRedirect: { name: keyNames.labels.REDIRECT, vdxfid: ids.labels.REDIRECT },
        webProxy: { name: keyNames.labels.PROXY, vdxfid: ids.labels.PROXY },
        webSite: { name: keyNames.labels.SITE, vdxfid: ids.labels.SITE },
        tlsFingerprint: { name: keyNames.labels.TLSA, vdxfid: ids.labels.TLSA }
      }
    };
  }

  async getRawIdentity(identity: string): Promise<unknown | null> {
    if (this.rpcClient.getRawIdentity) {
      return this.rpcClient.getRawIdentity(identity);
    }

    return this.rpcClient.getIdentity(identity);
  }

  async getRpcHealth(): Promise<Record<string, unknown>> {
    if (this.config.mode === "mock") {
      return { mode: "mock", status: "ok" };
    }

    const getInfo = this.rpcClient.getInfo;
    const getBlockchainInfo = this.rpcClient.getBlockchainInfo;
    if (!getInfo && !getBlockchainInfo) {
      return { mode: "rpc", status: "unavailable" };
    }

    const [info, blockchainInfo] = await Promise.all([
      getInfo ? getInfo.call(this.rpcClient) : Promise.resolve({}),
      getBlockchainInfo ? getBlockchainInfo.call(this.rpcClient) : Promise.resolve({})
    ]);

    return {
      mode: "rpc",
      status: "ok",
      chain: pickFirstString(blockchainInfo, ["chain"]) ?? pickFirstString(info, ["chain"]),
      name: pickFirstString(info, ["name"]),
      blocks: pickFirstNumber(info, ["blocks"]) ?? pickFirstNumber(blockchainInfo, ["blocks", "headers"]),
      height: pickFirstNumber(blockchainInfo, ["blocks", "headers"]) ?? pickFirstNumber(info, ["blocks"]),
      testnet: pickFirstBoolean(blockchainInfo, ["testnet"]) ?? pickFirstBoolean(info, ["testnet"]),
      verificationProgress: pickFirstNumber(blockchainInfo, ["verificationprogress"])
    };
  }

  async resolveDomain(domain: string, typeFilter?: VdnsRecordType): Promise<ResolveResult> {
    const parsedDomain = parseVdnsDomain(domain, this.config);
    const parsed = await this.getParsedIdentity(parsedDomain.identity);
    return {
      identity: parsedDomain.identity,
      domain: parsedDomain.domain,
      host: parsedDomain.host,
      records: filterRecordsForHostAndType(parsed.records, parsedDomain.host, typeFilter),
      warnings: parsed.warnings
    };
  }

  private async getParsedIdentity(identity: string): Promise<CachedParsedIdentity> {
    const cached = this.cache.get(identity);
    if (cached) {
      return cached;
    }

    const payload = await this.rpcClient.getIdentity(identity);
    if (!payload) {
      throw new IdentityNotFoundError(identity);
    }

    const vdnsVdxfIds = await this.getParserVdxfIds();
    const parsed = parseIdentityRecords(this.normalizeIdentityPayload(identity, payload), {
      ...(vdnsVdxfIds ? { vdnsVdxfIds } : {}),
      symbolicFallback: this.config.mode === "mock"
    });
    this.cache.set(identity, parsed, this.config.defaultTtl);
    return parsed;
  }

  private async getParserVdxfIds(): Promise<VdnsVdxfIds | undefined> {
    if (this.config.mode === "mock") {
      return undefined;
    }

    return this.getVdxfIds();
  }

  private async getVdxfIds(): Promise<VdnsVdxfIds> {
    const cacheKey = [
      this.config.mode,
      this.config.rootIdentity,
      this.config.tld,
      this.config.verusRpcUrl ?? "mock"
    ].join("|");
    const cached = VdnsResolver.vdxfIdsCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const resolver = this.resolveVdxfIds();
    VdnsResolver.vdxfIdsCache.set(cacheKey, resolver);
    try {
      return await resolver;
    } catch (error) {
      VdnsResolver.vdxfIdsCache.delete(cacheKey);
      throw error;
    }
  }

  private async resolveVdxfIds(): Promise<VdnsVdxfIds> {
    const keyNames = this.getVdxfKeyNames();
    const getVdxfId = this.rpcClient.getVdxfId?.bind(this.rpcClient);
    if (!getVdxfId) {
      if (this.config.mode === "mock") {
        return keyNames;
      }
      throw new Error("Configured RPC client does not support getvdxfid");
    }

    return resolveVdnsVdxfIds({ getVdxfId }, keyNames);
  }

  private getVdxfKeyNames(): VdnsVdxfKeyNames {
    return buildVdnsVdxfKeyNames(this.config.rootIdentity, this.config.tld);
  }

  private normalizeIdentityPayload(identity: string, payload: IdentityPayload): IdentityPayload {
    return {
      ...payload,
      identity: payload.identity || identity
    };
  }
}

function pickFirstString(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof input[key] === "string") {
      return input[key];
    }
  }
  return undefined;
}

function pickFirstNumber(input: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    if (typeof input[key] === "number") {
      return input[key];
    }
  }
  return undefined;
}

function pickFirstBoolean(input: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (typeof input[key] === "boolean") {
      return input[key];
    }
  }
  return undefined;
}
