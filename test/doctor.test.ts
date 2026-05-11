import { mkdtemp, writeFile, mkdir, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatResults } from "../src/doctor/format.js";
import { runDoctorChecks } from "../src/doctor/checks.js";
import { summarize, type CheckResult, type DoctorContext } from "../src/doctor/types.js";

describe("doctor internals", () => {
  it("aggregates statuses and chooses exit code", () => {
    const results: CheckResult[] = [
      { section: "Install", status: "PASS", label: "a", message: "ok" },
      { section: "Config", status: "WARN", label: "b", message: "warn" },
      { section: "Services", status: "FAIL", label: "c", message: "fail" }
    ];

    expect(summarize(results)).toEqual({ pass: 1, warn: 1, fail: 1, exitCode: 1 });
  });

  it("formats grouped output with PASS WARN and FAIL", () => {
    const output = formatResults([
      { section: "Install", status: "PASS", label: "Version", message: "0.1.4" },
      { section: "Config", status: "WARN", label: "Env file permissions", message: "mode 644", fix: "chmod 600 .env.local" },
      { section: "Verus RPC", status: "FAIL", label: "getinfo", message: "HTTP 401", fix: "Check credentials" }
    ]);

    expect(output).toContain("== Install ==");
    expect(output).toContain("[PASS] Version: 0.1.4");
    expect(output).toContain("[WARN] Env file permissions: mode 644");
    expect(output).toContain("[FAIL] getinfo: HTTP 401");
    expect(output).toContain("Fix: Check credentials");
  });

  it("redacts RPC password and auth headers from formatted output", () => {
    const output = formatResults([
      {
        section: "Config",
        status: "FAIL",
        label: "secret",
        message: "VERUS_RPC_PASSWORD=super-secret",
        details: ["authorization: Basic dXNlcjpzdXBlci1zZWNyZXQ="]
      }
    ]);

    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("dXNlcjpzdXBlci1zZWNyZXQ=");
    expect(output).toContain("VERUS_RPC_PASSWORD=[redacted]");
    expect(output).toContain("authorization: Basic [redacted]");
  });

  it("includes common failure fixes and promotes demo warnings in strict mode", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "vdns-doctor-"));
    const envFile = path.join(tmp, ".env.local");
    await mkdir(path.join(tmp, "logs"));
    await writeFile(envFile, [
      "VNS_MODE=rpc",
      "VNS_ROOT_IDENTITY=fum@",
      "VNS_TLD=vrsc",
      "VERUS_RPC_URL=http://127.0.0.1:18843",
      "VERUS_RPC_USER=user",
      "VERUS_RPC_PASSWORD=secret"
    ].join("\n"));
    await chmod(envFile, 0o600);

    const ctx: DoctorContext = {
      strict: true,
      requireHttps: false,
      home: tmp,
      installMode: "checkout",
      stateDir: tmp,
      envFile,
      logDir: path.join(tmp, "logs"),
      pidDir: path.join(tmp, "pids"),
      version: "test",
      env: {
        HOME: tmp,
        VNS_MODE: "rpc",
        VNS_ROOT_IDENTITY: "fum@",
        VNS_TLD: "vrsc",
        VERUS_RPC_URL: "http://127.0.0.1:18843",
        VERUS_RPC_USER: "user",
        VERUS_RPC_PASSWORD: "secret",
        VNS_RESOLVER_URL: "http://127.0.0.1:8080"
      }
    };
    const fetchImpl = async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/debug/config")) {
        return jsonResponse({ mode: "mock", rootIdentity: "fum@", tld: "vrsc", rpcUrlConfigured: true, rpcAuthConfigured: true });
      }
      if (url.includes("/resolve-domain/")) {
        return jsonResponse({ records: [] });
      }
      if (url === "http://chainvue.vrsc") {
        return new Response(null, { status: 404 });
      }
      if (url === "http://verus.vrsc") {
        return new Response(null, { status: 404 });
      }
      if (url === "http://127.0.0.1:18843") {
        return jsonResponse({ error: "unauthorized" }, 401);
      }
      return jsonRpcResponse({});
    };
    const execFile = async (file: string, args: string[]) => {
      if (file === "command" || file === "which") {
        return { status: 1, stdout: "", stderr: "" };
      }
      if (file === "lsof") {
        return { status: 1, stdout: "", stderr: "" };
      }
      return { status: 1, stdout: "", stderr: `${file} ${args.join(" ")}` };
    };

    const results = await runDoctorChecks(ctx, { fetch: fetchImpl as typeof fetch, execFile });
    expect(results.some((result) => result.status === "FAIL" && result.label === "resolver mode")).toBe(true);
    expect(results.some((result) => result.status === "FAIL" && result.section === "Records")).toBe(true);
    expect(formatResults(results)).toContain("Check VERUS_RPC_URL, rpcbind, rpcallowip, credentials");
  });

  it("reports HTTPS disabled as warning and --https as failure", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "vdns-doctor-https-"));
    try {
      const ctx: DoctorContext = {
        strict: false,
        requireHttps: true,
        home: tmp,
        installMode: "checkout",
        stateDir: tmp,
        envFile: path.join(tmp, ".env.local"),
        logDir: path.join(tmp, "logs"),
        pidDir: path.join(tmp, "pids"),
        version: "test",
        env: {
          HOME: tmp,
          VNS_MODE: "rpc",
          VNS_ROOT_IDENTITY: "fum@",
          VNS_TLD: "vrsc",
          VERUS_RPC_URL: "http://127.0.0.1:18843",
          VNS_RESOLVER_URL: "http://127.0.0.1:8080",
          VDNS_HTTPS_ENABLED: "false"
        }
      };
      const fetchImpl = async () => jsonResponse({});
      const execFile = async () => ({ status: 1, stdout: "", stderr: "" });

      const results = await runDoctorChecks(ctx, { fetch: fetchImpl as typeof fetch, execFile });
      expect(results.some((result) =>
        result.section === "HTTPS" &&
        result.label === "HTTPS enabled" &&
        result.status === "FAIL" &&
        result.message.includes("HTTPS is not enabled")
      )).toBe(true);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function jsonRpcResponse(result: unknown): Response {
  return jsonResponse({ result });
}
