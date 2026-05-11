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

  it("routes doctor help through the built entrypoint", async () => {
    const { stdout } = await runVdns(["doctor", "--help"]);
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("vdns doctor [--strict]");
  });

  it("routes https help and status through the built entrypoint", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-https-"));
    try {
      const help = await runVdns(["https", "--help"], { VDNS_STATE_DIR: stateDir });
      expect(help.stdout).toContain("vdns https <command>");

      const status = await runVdns(["https", "status"], {
        VDNS_STATE_DIR: stateDir,
        VDNS_ENV_FILE: path.join(stateDir, ".env.local"),
        VDNS_HTTPS_ENABLED: ""
      });
      expect(status.stdout).toContain("HTTPS env enabled: false");
      expect(status.stdout).toContain("CA cert: missing");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("prints expected log paths by service", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-logs-"));
    try {
      const env = { VDNS_STATE_DIR: stateDir, VDNS_LOG_DIR: path.join(stateDir, "logs") };
      const all = await runVdns(["logs"], env);
      expect(all.stdout).toContain(path.join(stateDir, "logs", "resolver.launchd.log"));
      expect(all.stdout).toContain(path.join(stateDir, "logs", "coredns.launchd.log"));
      expect(all.stdout).toContain(path.join(stateDir, "logs", "redirect.launchd.log"));

      const resolver = await runVdns(["logs", "resolver"], env);
      expect(resolver.stdout).toContain("resolver.launchd.log");
      expect(resolver.stdout).not.toContain("coredns.launchd.log");

      const coredns = await runVdns(["logs", "coredns"], env);
      expect(coredns.stdout).toContain("coredns.launchd.log");
      expect(coredns.stdout).not.toContain("resolver.launchd.log");

      const gateway = await runVdns(["logs", "gateway"], env);
      expect(gateway.stdout).toContain("redirect.launchd.log");
      expect(gateway.stdout).not.toContain("resolver.launchd.log");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
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
