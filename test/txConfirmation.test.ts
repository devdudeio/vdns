import { describe, expect, it, vi } from "vitest";
import { extractTxidFromUpdateIdentityResult, waitForTxConfirmation } from "../src/core/txConfirmation.js";

describe("extractTxidFromUpdateIdentityResult", () => {
  it("accepts string, result, and txid response shapes", () => {
    expect(extractTxidFromUpdateIdentityResult("tx-string")).toBe("tx-string");
    expect(extractTxidFromUpdateIdentityResult({ result: "tx-result" })).toBe("tx-result");
    expect(extractTxidFromUpdateIdentityResult({ txid: "tx-field" })).toBe("tx-field");
  });

  it("returns null for empty, invalid, and non-string shapes", () => {
    expect(extractTxidFromUpdateIdentityResult("")).toBeNull();
    expect(extractTxidFromUpdateIdentityResult(null)).toBeNull();
    expect(extractTxidFromUpdateIdentityResult(undefined)).toBeNull();
    expect(extractTxidFromUpdateIdentityResult({})).toBeNull();
    expect(extractTxidFromUpdateIdentityResult({ result: "" })).toBeNull();
    expect(extractTxidFromUpdateIdentityResult({ result: 123 })).toBeNull();
    expect(extractTxidFromUpdateIdentityResult({ txid: false })).toBeNull();
    expect(extractTxidFromUpdateIdentityResult(["tx"])).toBeNull();
  });
});

describe("waitForTxConfirmation", () => {
  it("resolves once confirmations reach the requested count", async () => {
    const rpcClient = {
      getRawTransaction: vi.fn()
        .mockResolvedValueOnce({ confirmations: 0 })
        .mockResolvedValueOnce({ confirmations: 1 })
    };

    vi.useFakeTimers();
    const result = waitForTxConfirmation(rpcClient, { txid: "tx", confirmations: 1, timeoutMs: 10_000, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(1);
    expect(rpcClient.getRawTransaction).toHaveBeenCalledTimes(2);
    expect(rpcClient.getRawTransaction).toHaveBeenCalledWith("tx", true);
    vi.useRealTimers();
  });

  it("keeps polling while transaction lookup returns null", async () => {
    const rpcClient = {
      getRawTransaction: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ confirmations: 1 })
    };

    vi.useFakeTimers();
    const result = waitForTxConfirmation(rpcClient, { txid: "tx", timeoutMs: 10_000, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(1);
    expect(rpcClient.getRawTransaction).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("treats missing confirmations as zero", async () => {
    const rpcClient = {
      getRawTransaction: vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({ confirmations: 1 })
    };

    vi.useFakeTimers();
    const result = waitForTxConfirmation(rpcClient, { txid: "tx", timeoutMs: 10_000, intervalMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(result).resolves.toBe(1);
    expect(rpcClient.getRawTransaction).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("times out with the required error", async () => {
    const rpcClient = {
      getRawTransaction: vi.fn(async () => ({ confirmations: 0 }))
    };

    vi.useFakeTimers();
    const result = waitForTxConfirmation(rpcClient, { txid: "tx", timeoutMs: 1000, intervalMs: 1000 });
    const expectation = expect(result).rejects.toThrow("Timed out waiting for transaction confirmation");
    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
    vi.useRealTimers();
  });
});
