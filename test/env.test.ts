import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadEnvFiles } from "../src/env.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("loadEnvFiles", () => {
  it("loads .env and lets .env.local override values not supplied by the shell", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "vns-env-"));
    await writeFile(path.join(tempDir, ".env"), "VNS_MODE=mock\nVNS_TLD=vrsc\n");
    await writeFile(path.join(tempDir, ".env.local"), "VNS_MODE=rpc\nVERUS_RPC_URL=http://127.0.0.1:18843\n");
    const env: NodeJS.ProcessEnv = {};

    loadEnvFiles({ cwd: tempDir, env });

    expect(env).toMatchObject({
      VNS_MODE: "rpc",
      VNS_TLD: "vrsc",
      VERUS_RPC_URL: "http://127.0.0.1:18843"
    });
  });

  it("does not override shell-provided environment variables", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "vns-env-"));
    await writeFile(path.join(tempDir, ".env"), "VNS_MODE=mock\n");
    await writeFile(path.join(tempDir, ".env.local"), "VNS_MODE=rpc\n");
    const env: NodeJS.ProcessEnv = { VNS_MODE: "mock" };

    loadEnvFiles({ cwd: tempDir, env });

    expect(env.VNS_MODE).toBe("mock");
  });
});
