import { describe, expect, it } from "vitest";
import { loadConfigFromEnv } from "../src/config.js";

describe("loadConfigFromEnv", () => {
  it("defaults to rpc mode and public read RPC", () => {
    expect(loadConfigFromEnv({})).toEqual({
      rootIdentity: "fum@",
      tld: "vrsc",
      defaultTtl: 300,
      mode: "rpc",
      port: 8080,
      verusRpcUrl: "https://api.verustest.net/",
      verusRpcTimeoutMs: 10000
    });
  });

  it("loads mock mode without an RPC URL when explicitly requested", () => {
    expect(loadConfigFromEnv({ VNS_MODE: "mock" })).toEqual({
      rootIdentity: "fum@",
      tld: "vrsc",
      defaultTtl: 300,
      mode: "mock",
      port: 8080,
      verusRpcTimeoutMs: 10000
    });
  });

  it("loads default rpc mode with an RPC URL", () => {
    expect(loadConfigFromEnv({ VERUS_RPC_URL: "http://127.0.0.1:18843" })).toEqual({
      rootIdentity: "fum@",
      tld: "vrsc",
      defaultTtl: 300,
      mode: "rpc",
      port: 8080,
      verusRpcUrl: "http://127.0.0.1:18843",
      verusRpcTimeoutMs: 10000
    });
  });

  it("loads custom values", () => {
    expect(
      loadConfigFromEnv({
        VNS_ROOT_IDENTITY: "VERUSNAMESERVICE@",
        VNS_TLD: "testnet",
        VNS_DEFAULT_TTL: "600",
        VNS_MODE: "rpc",
        PORT: "9090",
        VERUS_RPC_URL: "https://api.verustest.net/",
        VERUS_RPC_USER: "user",
        VERUS_RPC_PASSWORD: "secret",
        VERUS_RPC_TIMEOUT_MS: "2500"
      })
    ).toEqual({
      rootIdentity: "VERUSNAMESERVICE@",
      tld: "testnet",
      defaultTtl: 600,
      mode: "rpc",
      port: 9090,
      verusRpcUrl: "https://api.verustest.net/",
      verusRpcUser: "user",
      verusRpcPassword: "secret",
      verusRpcTimeoutMs: 2500
    });
  });

  it.each([
    [{ VNS_ROOT_IDENTITY: "VNS" }],
    [{ VNS_TLD: ".vrsc" }],
    [{ VNS_TLD: "VRSC" }],
    [{ VNS_DEFAULT_TTL: "29" }],
    [{ VNS_DEFAULT_TTL: "86401" }],
    [{ VNS_MODE: "bad" }],
    [{ PORT: "0" }],
    [{ PORT: "65536" }],
    [{ VERUS_RPC_URL: "not-a-url" }],
    [{ VERUS_RPC_TIMEOUT_MS: "0" }],
    [{ VERUS_RPC_TIMEOUT_MS: "abc" }]
  ])("rejects invalid config %#", (env) => {
    expect(() => loadConfigFromEnv(env)).toThrow("Invalid vDNS configuration");
  });
});
