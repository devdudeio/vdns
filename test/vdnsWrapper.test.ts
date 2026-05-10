import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");
const vdnsBin = path.join(repoRoot, "bin", "vdns");
const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as { version: string };

async function runVdns(args: string[], env: NodeJS.ProcessEnv = {}) {
  return execFileAsync(vdnsBin, args, {
    cwd: repoRoot,
    env: { ...process.env, VDNS_HOME: repoRoot, ...env }
  });
}

describe("vdns wrapper", () => {
  it("prints package version", async () => {
    const { stdout } = await runVdns(["--version"]);
    expect(stdout.trim()).toBe(packageJson.version);
  });

  it("prints help and paths", async () => {
    const help = await runVdns(["help"]);
    expect(help.stdout).toContain("Usage:");
    expect(help.stdout).toContain("setup             Create or update the vDNS env file");

    const paths = await runVdns(["paths"]);
    expect(paths.stdout).toContain(`VDNS_HOME=${repoRoot}`);
    expect(paths.stdout).toContain("VDNS_STATE_DIR=");
    expect(paths.stdout).toContain("VDNS_ENV_FILE=");
  });

  it("creates setup env file without printing password", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-"));
    const envFile = path.join(stateDir, ".env.local");
    try {
      const { stdout } = await runVdns([
        "setup",
        "--root", "fum@",
        "--tld", "vrsc",
        "--rpc-url", "http://192.168.0.106:18843",
        "--rpc-user", "user972661718",
        "--rpc-password", "dummy",
        "--force"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      expect(stdout).toContain(`Created ${envFile}`);
      expect(stdout).not.toContain("dummy");
      const contents = await readFile(envFile, "utf8");
      expect(contents).toContain("VNS_ROOT_IDENTITY=fum@");
      expect(contents).toContain("VNS_TLD=vrsc");
      expect(contents).toContain("VERUS_RPC_URL=http://192.168.0.106:18843");
      expect(contents).toContain("VERUS_RPC_PASSWORD=dummy");
      expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
