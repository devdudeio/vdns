import type { SUPPORTED_RECORD_TYPES } from "./constants.js";

export type VnsRecord =
  | { version: 1; type: "A"; name: string; value: string; ttl: number }
  | { version: 1; type: "AAAA"; name: string; value: string; ttl: number }
  | { version: 1; type: "CNAME"; name: string; value: string; ttl: number }
  | { version: 1; type: "TXT"; name: string; value: string; ttl: number }
  | { version: 1; type: "REDIRECT"; name: string; url: string; status: 301 | 302; ttl: number }
  | { version: 1; type: "PROXY"; name: string; url: string; ttl: number }
  | { version: 1; type: "SITE"; name: string; entry: string; manifestUri: string; sha256?: string | undefined; ttl: number }
  | { version: 1; type: "TLSA"; name: string; sha256: string; ttl: number };

export type VnsRecordType = (typeof SUPPORTED_RECORD_TYPES)[number];

export type IdentityPayload = {
  identity: string;
  contentmultimap?: Record<string, unknown>;
};

export type ResolveResult = {
  identity: string;
  domain?: string;
  host?: string;
  records: VnsRecord[];
  warnings: string[];
};

export interface VerusRpcLike {
  getIdentity(identity: string): Promise<IdentityPayload | null>;
  getRawIdentity?(identity: string): Promise<unknown | null>;
  getRawTransaction?(txid: string, verbose?: boolean): Promise<unknown | null>;
  getVdxfId?(key: string): Promise<string>;
  updateIdentity?(payload: unknown): Promise<unknown | null>;
  getInfo?(): Promise<Record<string, unknown>>;
  getBlockchainInfo?(): Promise<Record<string, unknown>>;
}
