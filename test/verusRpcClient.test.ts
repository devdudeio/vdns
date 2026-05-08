import { describe, expect, it, vi } from "vitest";
import { VNS_VDXF_KEYS } from "../src/core/constants.js";
import { VerusRpcClient, VerusRpcError } from "../src/rpc/verusRpcClient.js";

type FetchCall = {
  input: string;
  init: RequestInit;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function makeClient(
  response: Response | Promise<Response>,
  options: { user?: string; password?: string } = {}
): { client: VerusRpcClient; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: string, init: RequestInit) => {
    calls.push({ input, init });
    const resolved = await response;
    return resolved.clone();
  });
  const client = new VerusRpcClient({
    url: "https://api.verustest.net/",
    timeoutMs: 1000,
    fetch: fetchImpl,
    ...options
  });
  return { client, calls };
}

describe("VerusRpcClient", () => {
  it("adapts getidentity name and contentmultimap", async () => {
    const { client } = makeClient(jsonResponse({
      result: {
        identity: {
          name: "VRSCTEST@",
          contentmultimap: {
            [VNS_VDXF_KEYS.RECORD]: [{ version: 1, type: "TXT", name: "@", value: "ok", ttl: 300 }]
          }
        }
      }
    }));

    await expect(client.getIdentity("ignored@")).resolves.toEqual({
      identity: "VRSCTEST@",
      contentmultimap: {
        [VNS_VDXF_KEYS.RECORD]: [{ version: 1, type: "TXT", name: "@", value: "ok", ttl: 300 }]
      }
    });
  });

  it("appends @ to identity names when needed", async () => {
    const { client } = makeClient(jsonResponse({
      result: { identity: { name: "VRSCTEST", contentmultimap: {} } }
    }));

    await expect(client.getIdentity("VRSCTEST@")).resolves.toEqual({
      identity: "VRSCTEST@",
      contentmultimap: {}
    });
  });

  it("returns null for missing identity RPC code -5", async () => {
    const { client } = makeClient(jsonResponse({
      error: { code: -5, message: "Identity not found" }
    }));

    await expect(client.getIdentity("missing@")).resolves.toBeNull();
  });

  it("sets Basic Auth only when credentials are configured", async () => {
    const unauthenticated = makeClient(jsonResponse({ result: null }));
    await unauthenticated.client.getRawIdentity("VRSCTEST@");
    expect(unauthenticated.calls[0].init.headers).not.toHaveProperty("authorization");

    const authenticated = makeClient(jsonResponse({ result: null }), { user: "user", password: "secret" });
    await authenticated.client.getRawIdentity("VRSCTEST@");
    expect(authenticated.calls[0].init.headers).toHaveProperty(
      "authorization",
      `Basic ${Buffer.from("user:secret").toString("base64")}`
    );
  });

  it("maps HTTP, RPC, invalid JSON, and network failures to typed errors without secrets", async () => {
    const http = makeClient(jsonResponse({ error: "nope" }, 500), { user: "user", password: "secret" });
    await expect(http.client.getInfo()).rejects.toMatchObject({ kind: "http", statusCode: 500 });

    const rpc = makeClient(jsonResponse({ error: { code: -32601, message: "secret details" } }));
    await expect(rpc.client.getInfo()).rejects.toMatchObject({ kind: "rpc", rpcCode: -32601 });

    const invalidJson = makeClient(new Response("not-json", { status: 200 }));
    await expect(invalidJson.client.getInfo()).rejects.toMatchObject({ kind: "invalid-json" });

    const fetchImpl = vi.fn(async () => {
      throw new Error("secret network message");
    });
    const network = new VerusRpcClient({ url: "https://api.verustest.net/", fetch: fetchImpl });
    await expect(network.getInfo()).rejects.toMatchObject({ kind: "network" });

    for (const error of await Promise.allSettled([
      http.client.getInfo(),
      rpc.client.getInfo(),
      invalidJson.client.getInfo(),
      network.getInfo()
    ])) {
      if (error.status === "rejected") {
        expect(String(error.reason.message)).not.toContain("secret");
      }
    }
  });

  it("maps abort timeouts to typed timeout errors", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const client = new VerusRpcClient({ url: "https://api.verustest.net/", timeoutMs: 10, fetch: fetchImpl });

    const result = client.getInfo();
    const expectation = expect(result).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(10);
    await expectation;
    await result.catch((error) => expect(error).toBeInstanceOf(VerusRpcError));
    vi.useRealTimers();
  });

  it("calls expected RPC methods", async () => {
    const { client, calls } = makeClient(jsonResponse({ result: {} }));

    await client.getRawIdentity("VRSCTEST@");
    await client.getInfo();
    await client.getBlockchainInfo();
    await client.getRawTransaction("tx");

    expect(calls.map((call) => JSON.parse(String(call.init.body)).method)).toEqual([
      "getidentity",
      "getinfo",
      "getblockchaininfo",
      "getrawtransaction"
    ]);
  });

  it("calls getrawtransaction with verbose encoded as 1 or 0", async () => {
    const { client, calls } = makeClient(jsonResponse({ result: { confirmations: 1 } }));

    await client.getRawTransaction("tx", true);
    await client.getRawTransaction("tx", false);
    await client.getRawTransaction("tx");

    expect(calls.map((call) => JSON.parse(String(call.init.body)).params)).toEqual([
      ["tx", 1],
      ["tx", 0],
      ["tx", 0]
    ]);
  });

  it("calls getvdxfid and accepts string or object response shapes", async () => {
    const stringResult = makeClient(jsonResponse({ result: "vdxf-id" }));
    await expect(stringResult.client.getVdxfId("dude.vrsc::vns.record")).resolves.toBe("vdxf-id");

    const objectResult = makeClient(jsonResponse({ result: { vdxfid: "vdxf-id-2" } }));
    await expect(objectResult.client.getVdxfId("dude.vrsc::vns.record")).resolves.toBe("vdxf-id-2");

    expect(JSON.parse(String(stringResult.calls[0].init.body))).toMatchObject({
      method: "getvdxfid",
      params: ["dude.vrsc::vns.record"]
    });
  });

  it("throws a typed error when getvdxfid cannot extract an id", async () => {
    const { client } = makeClient(jsonResponse({ result: { notVdxfid: "nope" } }));

    await expect(client.getVdxfId("dude.vrsc::vns.record")).rejects.toMatchObject({
      kind: "unexpected-result"
    });
  });

  it("calls updateidentity with the provided payload", async () => {
    const { client, calls } = makeClient(jsonResponse({ result: { txid: "abc" } }));
    const payload = { name: "dude@", contentmultimap: { key: [] } };

    await expect(client.updateIdentity(payload)).resolves.toEqual({ txid: "abc" });
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      method: "updateidentity",
      params: [payload]
    });
  });
});
