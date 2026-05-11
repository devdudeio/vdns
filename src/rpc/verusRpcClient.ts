import type { IdentityPayload, VerusRpcLike } from "../core/types.js";
import { DEFAULT_VERUS_READ_RPC_URL } from "../config.js";

type JsonRpcResponse = {
  result?: unknown;
  error?: { code: number; message: string };
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type VerusRpcClientOptions = {
  url?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
  timeoutMs?: number;
  fetch?: FetchLike;
};

export type VerusRpcErrorKind =
  | "rpc"
  | "http"
  | "invalid-json"
  | "network"
  | "timeout"
  | "unexpected-result";

export class VerusRpcError extends Error {
  constructor(
    readonly kind: VerusRpcErrorKind,
    message: string,
    readonly statusCode?: number,
    readonly rpcCode?: number
  ) {
    super(message);
    this.name = "VerusRpcError";
  }
}

export class VerusRpcClient implements VerusRpcLike {
  private readonly rpcUrl: string;
  private readonly user: string | undefined;
  private readonly password: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: FetchLike;

  constructor(options: VerusRpcClientOptions = {}) {
    const url = options.url ?? process.env.VERUS_RPC_URL ?? DEFAULT_VERUS_READ_RPC_URL;
    if (!url) {
      throw new Error("VERUS_RPC_URL is required in rpc mode");
    }
    this.rpcUrl = url;
    this.user = options.user ?? process.env.VERUS_RPC_USER;
    this.password = options.password ?? process.env.VERUS_RPC_PASSWORD;
    this.timeoutMs = options.timeoutMs ?? Number(process.env.VERUS_RPC_TIMEOUT_MS ?? 10_000);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async getIdentity(identity: string): Promise<IdentityPayload | null> {
    const result = await this.call("getidentity", [identity], "vdns-getidentity");
    if (!result || typeof result !== "object") {
      return null;
    }

    return adaptRpcIdentityPayload(identity, result as Record<string, unknown>);
  }

  async getRawIdentity(identity: string): Promise<unknown | null> {
    return this.call("getidentity", [identity], "vdns-raw-getidentity");
  }

  async getInfo(): Promise<Record<string, unknown>> {
    const result = await this.call("getinfo", [], "vdns-getinfo");
    return isRecord(result) ? result : {};
  }

  async getBlockchainInfo(): Promise<Record<string, unknown>> {
    const result = await this.call("getblockchaininfo", [], "vdns-getblockchaininfo");
    return isRecord(result) ? result : {};
  }

  async getRawTransaction(txid: string, verbose = false): Promise<unknown | null> {
    return this.call("getrawtransaction", [txid, verbose ? 1 : 0], "vdns-getrawtransaction");
  }

  async getVdxfId(key: string): Promise<string> {
    const result = await this.call("getvdxfid", [key], "vdns-getvdxfid");
    if (typeof result === "string" && result.length > 0) {
      return result;
    }

    if (isRecord(result) && typeof result.vdxfid === "string" && result.vdxfid.length > 0) {
      return result.vdxfid;
    }

    throw new VerusRpcError("unexpected-result", "Verus RPC getvdxfid returned no vdxfid");
  }

  async updateIdentity(payload: unknown): Promise<unknown | null> {
    return this.call("updateidentity", [payload], "vdns-updateidentity");
  }

  async call<T = unknown>(method: string, params: unknown[] = [], id = `vdns-${method}`): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.rpcUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...this.authHeader()
        },
        body: JSON.stringify({
          jsonrpc: "1.0",
          id,
          method,
          params
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw new VerusRpcError("timeout", `Verus RPC ${method} timed out after ${this.timeoutMs}ms`);
      }
      throw new VerusRpcError("network", `Verus RPC ${method} network failure`);
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new VerusRpcError("http", `Verus RPC ${method} failed with HTTP ${response.status}`, response.status);
    }

    let payload: JsonRpcResponse;
    try {
      payload = (await response.json()) as JsonRpcResponse;
    } catch {
      throw new VerusRpcError("invalid-json", `Verus RPC ${method} returned invalid JSON`);
    }

    if (payload.error) {
      if (payload.error.code === -5) {
        return null;
      }
      throw new VerusRpcError("rpc", `Verus RPC ${method} error ${payload.error.code}`, undefined, payload.error.code);
    }

    return (payload.result ?? null) as T | null;
  }

  private authHeader(): Record<string, string> {
    if (!this.user && !this.password) {
      return {};
    }

    return {
      authorization: `Basic ${Buffer.from(`${this.user ?? ""}:${this.password ?? ""}`).toString("base64")}`
    };
  }
}

/*
 * Real getidentity responses wrap the payload in result.identity. The resolver
 * wants the internal identity name plus the contentmultimap.
 */
function adaptRpcIdentityPayload(requestedIdentity: string, result: Record<string, unknown>): IdentityPayload {
  const nestedIdentity = isRecord(result.identity) ? result.identity : result;
  const rawName = typeof nestedIdentity.name === "string" && nestedIdentity.name.length > 0
    ? nestedIdentity.name
    : requestedIdentity;
  const identity = rawName.endsWith("@") ? rawName : `${rawName}@`;
  const contentmultimap = nestedIdentity.contentmultimap;

  return isRecord(contentmultimap) ? { identity, contentmultimap } : { identity };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
