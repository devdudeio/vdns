import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
        "--root", "vdns@",
        "--tld", "vdns",
        "--rpc-url", "http://192.168.0.106:18843",
        "--write-rpc-url", "http://192.168.0.106:18843",
        "--write-rpc-user", "user972661718",
        "--write-rpc-password", "dummy",
        "--force"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      expect(stdout).toContain(`Created ${envFile}`);
      expect(stdout).not.toContain("dummy");
      const contents = await readFile(envFile, "utf8");
      expect(contents).toContain("VDNS_ROOT_IDENTITY=vdns@");
      expect(contents).toContain("VDNS_TLD=vdns");
      expect(contents).toContain("VERUS_RPC_URL=http://192.168.0.106:18843");
      expect(contents).toContain("VERUS_WRITE_RPC_URL=http://192.168.0.106:18843");
      expect(contents).toContain("VERUS_WRITE_RPC_PASSWORD=dummy");
      expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("prints bootstrap help", async () => {
    const { stdout } = await runVdns(["bootstrap", "--help"]);
    expect(stdout).toContain("Usage: vdns bootstrap");
    expect(stdout).toContain("--yes");
    expect(stdout).toContain("--no-install");
  });

  it("bootstraps non-interactively with public read RPC", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-bootstrap-"));
    const envFile = path.join(stateDir, ".env.local");
    try {
      const { stdout } = await runVdns([
        "bootstrap",
        "--yes",
        "--no-install",
        "--no-start",
        "--no-verify"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      expect(stdout).toContain(`Config: ${envFile}`);
      expect(stdout).toContain("Read RPC: https://api.verustest.net/");
      const contents = await readFile(envFile, "utf8");
      expect(contents).toContain("VERUS_RPC_URL=https://api.verustest.net/");
      expect(contents).toContain("VDNS_HTTPS_ENABLED=true");
      expect((await stat(envFile)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("bootstraps write RPC flags without printing the password", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-bootstrap-write-"));
    const envFile = path.join(stateDir, ".env.local");
    try {
      const { stdout } = await runVdns([
        "bootstrap",
        "--yes",
        "--no-https",
        "--no-install",
        "--no-start",
        "--no-verify",
        "--write-rpc-url", "http://127.0.0.1:18843",
        "--write-rpc-user", "writer",
        "--write-rpc-password", "super-secret"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      expect(stdout).toContain("Write RPC configured: true");
      expect(stdout).not.toContain("super-secret");
      const contents = await readFile(envFile, "utf8");
      expect(contents).toContain("VERUS_WRITE_RPC_URL=http://127.0.0.1:18843");
      expect(contents).toContain("VERUS_WRITE_RPC_USER=writer");
      expect(contents).toContain("VERUS_WRITE_RPC_PASSWORD=super-secret");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it("bootstrap preserves existing env values unless forced", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-wrapper-bootstrap-preserve-"));
    const envFile = path.join(stateDir, ".env.local");
    try {
      await writeFile(envFile, "VERUS_RPC_URL=http://existing.example\nVDNS_HTTPS_ENABLED=false\n", { mode: 0o600 });
      await runVdns([
        "bootstrap",
        "--yes",
        "--no-https",
        "--no-install",
        "--no-start",
        "--no-verify",
        "--rpc-url", "https://api.verustest.net/"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      const preserved = await readFile(envFile, "utf8");
      expect(preserved).toContain("VERUS_RPC_URL=http://existing.example");
      expect(preserved).toContain("VDNS_HTTPS_ENABLED=false");
      expect(preserved).toContain("VDNS_ROOT_IDENTITY=vdns@");
      expect((preserved.match(/^VERUS_RPC_URL=/gm) ?? []).length).toBe(1);

      await runVdns([
        "bootstrap",
        "--yes",
        "--force",
        "--no-https",
        "--no-install",
        "--no-start",
        "--no-verify",
        "--rpc-url", "https://api.verustest.net/"
      ], { VDNS_STATE_DIR: stateDir, VDNS_ENV_FILE: envFile });

      const forced = await readFile(envFile, "utf8");
      expect(forced).toContain("VERUS_RPC_URL=https://api.verustest.net/");
      expect(forced).not.toContain("http://existing.example");
      expect((forced.match(/^VERUS_RPC_URL=/gm) ?? []).length).toBe(1);
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
