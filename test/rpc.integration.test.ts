import { describe, expect, it } from "vitest";
import { VerusRpcClient } from "../src/rpc/verusRpcClient.js";

const runIntegration = process.env.RUN_RPC_INTEGRATION_TESTS === "1" && Boolean(process.env.VERUS_RPC_URL);

if (runIntegration) {
  const client = new VerusRpcClient({
    url: process.env.VERUS_RPC_URL,
    user: process.env.VERUS_RPC_USER,
    password: process.env.VERUS_RPC_PASSWORD,
    timeoutMs: Number(process.env.VERUS_RPC_TIMEOUT_MS ?? 10000)
  });

  describe("Verus RPC integration", () => {
    it("gets node info", async () => {
      await expect(client.getInfo()).resolves.toEqual(expect.any(Object));
    });

    it("gets blockchain info", async () => {
      await expect(client.getBlockchainInfo()).resolves.toEqual(expect.any(Object));
    });

    it("gets raw VDNSTEST identity", async () => {
      await expect(client.getRawIdentity("VDNSTEST@")).resolves.toEqual(expect.any(Object));
    });

    it("returns null for a missing identity", async () => {
      const missing = `missing-${Date.now()}.VDNS@`;
      await expect(client.getRawIdentity(missing)).resolves.toBeNull();
    });

    it("adapts VDNSTEST identity", async () => {
      const identity = await client.getIdentity("VDNSTEST@");
      expect(identity).toMatchObject({ identity: expect.stringMatching(/@$/) });
    });
  });
} else {
  describe.skip("Verus RPC integration", () => {
    it("is skipped unless RUN_RPC_INTEGRATION_TESTS=1 and VERUS_RPC_URL are set", () => {});
  });
}
