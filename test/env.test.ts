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
    tempDir = await mkdtemp(path.join(tmpdir(), "vdns-env-"));
    await writeFile(path.join(tempDir, ".env"), "VDNS_MODE=mock\nVDNS_TLD=vdns\n");
    await writeFile(path.join(tempDir, ".env.local"), "VDNS_MODE=rpc\nVERUS_RPC_URL=http://127.0.0.1:18843\n");
    const env: NodeJS.ProcessEnv = {};

    loadEnvFiles({ cwd: tempDir, env });

    expect(env).toMatchObject({
      VDNS_MODE: "rpc",
      VDNS_TLD: "vdns",
      VERUS_RPC_URL: "http://127.0.0.1:18843"
    });
  });

  it("does not override shell-provided environment variables", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "vdns-env-"));
    await writeFile(path.join(tempDir, ".env"), "VDNS_MODE=mock\n");
    await writeFile(path.join(tempDir, ".env.local"), "VDNS_MODE=rpc\n");
    const env: NodeJS.ProcessEnv = { VDNS_MODE: "mock" };

    loadEnvFiles({ cwd: tempDir, env });

    expect(env.VDNS_MODE).toBe("mock");
  });
});
