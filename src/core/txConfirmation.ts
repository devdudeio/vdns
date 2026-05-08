import type { VerusRpcLike } from "./types.js";

export type WaitForTxConfirmationOptions = {
  txid: string;
  confirmations?: number;
  timeoutMs?: number;
  intervalMs?: number;
};

const DEFAULT_CONFIRMATIONS = 1;
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_INTERVAL_MS = 5_000;

export function extractTxidFromUpdateIdentityResult(result: unknown): string | null {
  if (typeof result === "string") {
    return result.length > 0 ? result : null;
  }

  if (!isRecord(result)) {
    return null;
  }

  if (typeof result.result === "string" && result.result.length > 0) {
    return result.result;
  }

  if (typeof result.txid === "string" && result.txid.length > 0) {
    return result.txid;
  }

  return null;
}

export async function waitForTxConfirmation(
  rpcClient: Pick<VerusRpcLike, "getRawTransaction">,
  options: WaitForTxConfirmationOptions
): Promise<number> {
  const requestedConfirmations = options.confirmations ?? DEFAULT_CONFIRMATIONS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (true) {
    const transaction = await rpcClient.getRawTransaction?.(options.txid, true);
    const confirmations = extractConfirmations(transaction);
    if (confirmations >= requestedConfirmations) {
      return confirmations;
    }

    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for transaction confirmation");
    }

    await sleep(Math.min(intervalMs, Math.max(0, deadline - Date.now())));
  }
}

function extractConfirmations(transaction: unknown): number {
  if (!isRecord(transaction) || typeof transaction.confirmations !== "number") {
    return 0;
  }

  return Number.isFinite(transaction.confirmations) ? transaction.confirmations : 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
