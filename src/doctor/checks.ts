import { access, readFile, stat } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { VerusRpcClient } from "../rpc/verusRpcClient.js";
import { DEFAULT_VERUS_READ_RPC_URL } from "../config.js";
import { caStatus } from "../tls/certs.js";
import { deriveTlsPaths } from "../tls/paths.js";
import { applyStrict, type CheckResult, type DoctorContext } from "./types.js";

type ExecResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type ExecFile = (file: string, args: string[], timeoutMs?: number) => Promise<ExecResult>;
type FetchLike = typeof fetch;

export type DoctorDeps = {
  execFile?: ExecFile;
  fetch?: FetchLike;
};

const staleDocumentsPathParts = ["", "Users", "robertlech", "Documents", "vdns"];
const checkoutPathParts = ["", "Users", "robertlech", "Developer", "vdns"];

export async function runDoctorChecks(ctx: DoctorContext, deps: DoctorDeps = {}): Promise<CheckResult[]> {
  const execFile = deps.execFile ?? defaultExecFile;
  const fetchImpl = deps.fetch ?? fetch;
  const rawResults = [
    ...(await checkInstall(ctx)),
    ...(await checkConfig(ctx)),
    ...(await checkRpc(ctx, fetchImpl)),
    ...(await checkServices(ctx, execFile, fetchImpl)),
    ...(await checkMacDns(ctx, execFile)),
    ...(await checkWeb(ctx, execFile, fetchImpl)),
    ...(await checkHttps(ctx, execFile, fetchImpl)),
    ...(await checkRecords(ctx, fetchImpl)),
    ...checkLogs(ctx)
  ];
  return rawResults.map((result) => applyStrict(result, ctx.strict));
}

async function checkHttps(ctx: DoctorContext, execFile: ExecFile, fetchImpl: FetchLike): Promise<CheckResult[]> {
  const enabled = (ctx.env.VDNS_HTTPS_ENABLED ?? "false").toLowerCase() === "true";
  const paths = deriveTlsPaths({ ...process.env, ...ctx.env, VDNS_STATE_DIR: ctx.stateDir });
  const status = await caStatus(paths);
  const strictHttps = ctx.requireHttps || (ctx.strict && enabled);
  const results: CheckResult[] = [{
    section: "HTTPS",
    status: enabled ? "PASS" : "WARN",
    label: "HTTPS enabled",
    message: enabled ? "VDNS_HTTPS_ENABLED=true" : "HTTPS is not enabled. HTTP vDNS is working, but https://*.vdns will not work.",
    fix: enabled ? undefined : "vdns https init-ca && vdns https install-ca; set VDNS_HTTPS_ENABLED=true; vdns restart",
    strictFailure: strictHttps
  }];

  results.push({
    section: "HTTPS",
    status: status.caCertExists && status.caKeyExists ? "PASS" : "WARN",
    label: "CA files",
    message: `cert=${status.caCertExists} key=${status.caKeyExists}`,
    fix: "vdns https init-ca",
    strictFailure: strictHttps
  });
  results.push({
    section: "HTTPS",
    status: status.caKeySafe === true ? "PASS" : status.caKeySafe === null ? "WARN" : "FAIL",
    label: "CA key permissions",
    message: status.caKeySafe === null ? "CA key missing" : `safe=${status.caKeySafe}`,
    fix: `chmod 600 ${paths.caKey}`
  });

  const trusted = process.platform === "darwin" && status.caCertExists ? await checkCaTrusted(execFile) : "unknown";
  results.push({
    section: "HTTPS",
    status: trusted === true ? "PASS" : "WARN",
    label: "macOS CA trust",
    message: `trusted=${trusted}`,
    fix: "vdns https install-ca",
    strictFailure: strictHttps
  });
  const httpsPort = await checkPort(execFile, "HTTPS gateway", "TCP", ctx.env.VDNS_HTTPS_PORT ?? "443", ctx.env.VDNS_HTTPS_HOST ?? "127.0.0.1");
  results.push({ ...httpsPort, section: "HTTPS", strictFailure: strictHttps });

  if (enabled) {
    const proxyDomain = ctx.env.VDNS_DOCTOR_PROXY_DOMAIN ?? `verus.${ctx.env.VDNS_TLD ?? "vdns"}`;
    const redirectDomain = ctx.env.VDNS_DOCTOR_REDIRECT_DOMAIN ?? `chainvue.${ctx.env.VDNS_TLD ?? "vdns"}`;
    try {
      const response = await curlHead(execFile, `https://${proxyDomain}`);
      const proxy = response.headers["x-vdns-proxy"];
      const target = response.headers["x-vdns-proxy-target-host"];
      results.push({
        section: "HTTPS",
        status: proxy === "1" && target === "verus.io" ? "PASS" : "WARN",
        label: `curl ${proxyDomain}`,
        message: `HTTP ${response.status} x-vdns-proxy=${proxy ?? ""} x-vdns-proxy-target-host=${target ?? ""}`,
        fix: "Check CA trust, HTTPS gateway logs, and PROXY record.",
        strictFailure: strictHttps
      });
    } catch (error) {
      results.push({ section: "HTTPS", status: "WARN", label: `curl ${proxyDomain}`, message: errorMessage(error), fix: "vdns https status; vdns logs gateway", strictFailure: strictHttps });
    }

    try {
      const response = await curlHead(execFile, `https://${redirectDomain}`);
      results.push({
        section: "HTTPS",
        status: response.status >= 300 && response.status < 400 ? "PASS" : "WARN",
        label: `curl ${redirectDomain}`,
        message: `HTTP ${response.status}`,
        fix: "Check HTTPS gateway logs and REDIRECT record.",
        strictFailure: strictHttps
      });
    } catch (error) {
      results.push({ section: "HTTPS", status: "WARN", label: `curl ${redirectDomain}`, message: errorMessage(error), fix: "vdns https status; vdns logs gateway", strictFailure: strictHttps });
    }
  }

  return ctx.requireHttps ? results.map((result) => result.status === "WARN" ? { ...result, status: "FAIL" as const } : result) : results;
}

export async function checkInstall(ctx: DoctorContext): Promise<CheckResult[]> {
  const files = [
    ["Resolver entrypoint", path.join(ctx.home, "dist/index.js"), "pnpm build"],
    ["Gateway entrypoint", path.join(ctx.home, "dist/redirect-index.js"), "pnpm build"],
    ["Wrapper", path.join(ctx.home, "bin/vdns"), "reinstall vdns or restore bin/vdns"],
    ["macOS scripts", path.join(ctx.home, "scripts/macos"), "reinstall vdns"],
    ["CoreDNS binary", path.join(ctx.home, "coredns/coredns-vdns"), "cd coredns && ./build-coredns.sh"]
  ] as const;
  const results: CheckResult[] = [{
    section: "Install",
    status: "PASS",
    label: "Version",
    message: `${ctx.version} (${ctx.installMode})`,
    details: [`VDNS_HOME=${ctx.home}`, `VDNS_STATE_DIR=${ctx.stateDir}`]
  }];

  for (const [label, file, fix] of files) {
    const exists = await fileExists(file);
    results.push({
      section: "Install",
      status: exists ? "PASS" : "FAIL",
      label,
      message: exists ? file : `missing ${file}`,
      fix: exists ? undefined : fix
    });
  }

  results.push(...await checkLaunchdPlists(ctx));
  return results;
}

async function checkLaunchdPlists(ctx: DoctorContext): Promise<CheckResult[]> {
  const home = ctx.env.HOME ?? process.env.HOME ?? "";
  const candidates = [
    path.join(home, "Library/LaunchAgents/io.vdns.resolver.plist"),
    path.join(home, "Library/LaunchAgents/io.vdns.coredns.plist"),
    "/Library/LaunchDaemons/io.vdns.redirect.plist"
  ];
  const results: CheckResult[] = [];
  for (const plist of candidates) {
    let content = "";
    try {
      content = await readFile(plist, "utf8");
    } catch {
      results.push({ section: "Install", status: "WARN", label: "launchd plist", message: `not installed: ${plist}`, fix: "vdns install" });
      continue;
    }

    if (content.includes(path.join(...staleDocumentsPathParts))) {
      results.push({
        section: "Install",
        status: "FAIL",
        label: "launchd plist",
        message: `stale Documents checkout path in ${plist}`,
        fix: "vdns uninstall && vdns install"
      });
    } else if (content.includes(path.join(...checkoutPathParts)) && !(ctx.installMode === "checkout" && ctx.home === path.join(...checkoutPathParts))) {
      results.push({
        section: "Install",
        status: "WARN",
        label: "launchd plist",
        message: `plist points at local checkout: ${plist}`,
        fix: "vdns uninstall && vdns install"
      });
    } else {
      results.push({ section: "Install", status: "PASS", label: "launchd plist", message: plist });
    }
  }
  return results;
}

export async function checkConfig(ctx: DoctorContext): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  let envStat;
  try {
    envStat = await stat(ctx.envFile);
  } catch {
    return [{
      section: "Config",
      status: "FAIL",
      label: "Env file",
      message: `missing ${ctx.envFile}`,
      fix: "vdns setup"
    }];
  }

  const mode = envStat.mode & 0o777;
  results.push({
    section: "Config",
    status: (mode & 0o077) === 0 ? "PASS" : "WARN",
    label: "Env file permissions",
    message: `${ctx.envFile} mode ${mode.toString(8)}`,
    fix: (mode & 0o077) === 0 ? undefined : `chmod 600 ${ctx.envFile}`
  });

  const required = ["VDNS_MODE", "VDNS_ROOT_IDENTITY", "VDNS_TLD"];
  for (const key of required) {
    results.push({
      section: "Config",
      status: ctx.env[key] ? "PASS" : "FAIL",
      label: key,
      message: ctx.env[key] ? safeConfigValue(key, ctx.env[key]) : "missing",
      fix: ctx.env[key] ? undefined : "vdns setup"
    });
  }

  results.push({
    section: "Config",
    status: "PASS",
    label: "Read RPC",
    message: safeConfigValue("VERUS_RPC_URL", ctx.env.VERUS_RPC_URL ?? DEFAULT_VERUS_READ_RPC_URL)
  });
  results.push({
    section: "Config",
    status: ctx.env.VERUS_WRITE_RPC_URL ? "PASS" : "WARN",
    label: "Write RPC",
    message: ctx.env.VERUS_WRITE_RPC_URL ? safeConfigValue("VERUS_WRITE_RPC_URL", ctx.env.VERUS_WRITE_RPC_URL) : "not configured; record writes require VERUS_WRITE_RPC_URL or --write-rpc-url",
    fix: ctx.env.VERUS_WRITE_RPC_URL ? undefined : "Set VERUS_WRITE_RPC_URL, VERUS_WRITE_RPC_USER, and VERUS_WRITE_RPC_PASSWORD for updateidentity."
  });
  return results;
}

async function checkRpc(ctx: DoctorContext, fetchImpl: FetchLike): Promise<CheckResult[]> {
  const client = new VerusRpcClient({
    url: ctx.env.VERUS_RPC_URL ?? DEFAULT_VERUS_READ_RPC_URL,
    user: ctx.env.VERUS_RPC_USER,
    password: ctx.env.VERUS_RPC_PASSWORD,
    timeoutMs: Number(ctx.env.VERUS_RPC_TIMEOUT_MS ?? 3000),
    fetch: fetchImpl
  });
  const results: CheckResult[] = [];
  try {
    const info = await client.getInfo();
    results.push({ section: "Verus RPC", status: "PASS", label: "getinfo", message: rpcSummary(info, ["chain", "name", "blocks", "version"]) });
  } catch (error) {
    results.push(rpcFailure("getinfo", error));
  }
  try {
    const info = await client.getBlockchainInfo();
    results.push({ section: "Verus RPC", status: "PASS", label: "getblockchaininfo", message: rpcSummary(info, ["chain", "blocks", "headers", "verificationprogress"]) });
  } catch (error) {
    results.push(rpcFailure("getblockchaininfo", error));
  }
  try {
    const identity = await client.getRawIdentity(ctx.env.VDNS_ROOT_IDENTITY ?? "fum@");
    results.push({
      section: "Verus RPC",
      status: identity ? "PASS" : "FAIL",
      label: "getidentity",
      message: identity ? `found ${ctx.env.VDNS_ROOT_IDENTITY ?? "fum@"}` : `missing ${ctx.env.VDNS_ROOT_IDENTITY ?? "fum@"}`,
      fix: identity ? undefined : "Check VDNS_ROOT_IDENTITY and Verus node sync state."
    });
  } catch (error) {
    results.push(rpcFailure("getidentity", error));
  }
  return results;
}

async function checkServices(ctx: DoctorContext, execFile: ExecFile, fetchImpl: FetchLike): Promise<CheckResult[]> {
  const resolverUrl = ctx.env.VDNS_RESOLVER_URL ?? `http://127.0.0.1:${ctx.env.PORT ?? "8080"}`;
  const dnsPort = ctx.env.VDNS_DNS_PORT ?? "1053";
  const results: CheckResult[] = [];
  results.push(await checkResolverDebug(ctx, resolverUrl, fetchImpl));
  results.push(await checkPort(execFile, "CoreDNS TCP", "TCP", dnsPort, "127.0.0.1"));
  results.push(await checkPort(execFile, "CoreDNS UDP", "UDP", dnsPort, "127.0.0.1"));
  const dig = await commandExists(execFile, "dig");
  if (!dig) {
    results.push({ section: "Services", status: "WARN", label: "dig", message: "dig is unavailable", fix: "brew install bind" });
  } else {
    const domain = ctx.env.VDNS_DOCTOR_A_DOMAIN ?? `google.${ctx.env.VDNS_TLD ?? "vdns"}`;
    const result = await execFile("dig", ["@127.0.0.1", "-p", dnsPort, domain, "A", "+short"], 5000);
    results.push({
      section: "Services",
      status: result.status === 0 && result.stdout.trim().length > 0 ? "PASS" : "WARN",
      label: "direct DNS query",
      message: result.stdout.trim() || `no A answer for ${domain}`,
      fix: "vdns start",
      strictFailure: true
    });
  }
  return results;
}

async function checkResolverDebug(ctx: DoctorContext, resolverUrl: string, fetchImpl: FetchLike): Promise<CheckResult> {
  try {
    const response = await fetchImpl(`${resolverUrl}/debug/config`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) {
      return { section: "Services", status: "FAIL", label: "resolver /debug/config", message: `HTTP ${response.status}`, fix: "vdns start" };
    }
    const body = await response.json() as Record<string, unknown>;
    const modeMatches = body.mode === (ctx.env.VDNS_MODE ?? "rpc");
    const details = [
      `mode=${String(body.mode)}`,
      `rootIdentity=${String(body.rootIdentity)}`,
      `tld=${String(body.tld)}`,
      `rpcUrlConfigured=${String(body.rpcUrlConfigured)}`,
      `rpcAuthConfigured=${String(body.rpcAuthConfigured)}`
    ];
    if (body.mode === "mock") {
      return { section: "Services", status: "WARN", label: "resolver mode", message: "resolver is running in mock mode", details, fix: "Set VDNS_MODE=rpc and restart.", strictFailure: true };
    }
    return { section: "Services", status: modeMatches ? "PASS" : "FAIL", label: "resolver /debug/config", message: modeMatches ? "matches env" : "does not match env", details, fix: modeMatches ? undefined : "vdns restart" };
  } catch (error) {
    return { section: "Services", status: "FAIL", label: "resolver /debug/config", message: errorMessage(error), fix: "vdns start" };
  }
}

async function checkMacDns(ctx: DoctorContext, execFile: ExecFile): Promise<CheckResult[]> {
  const tld = ctx.env.VDNS_TLD ?? "vdns";
  const port = ctx.env.VDNS_DNS_PORT ?? "1053";
  const resolverFile = `/etc/resolver/${tld}`;
  const results: CheckResult[] = [{
    section: "macOS DNS",
    status: "WARN",
    label: "macOS resolver note",
    message: "On macOS, dig without @server may not use /etc/resolver. Use dscacheutil or dns-sd."
  }];
  try {
    const content = await readFile(resolverFile, "utf8");
    const hasDomain = new RegExp(`^domain\\s+${escapeRegex(tld)}$`, "m").test(content);
    const hasNameserver = /^nameserver\s+127\.0\.0\.1$/m.test(content);
    const hasPort = new RegExp(`^port\\s+${escapeRegex(port)}$`, "m").test(content);
    results.push({
      section: "macOS DNS",
      status: hasDomain && hasNameserver && hasPort ? "PASS" : "FAIL",
      label: resolverFile,
      message: hasDomain && hasNameserver && hasPort ? "configured" : "missing domain, nameserver, or port",
      fix: "vdns install"
    });
  } catch {
    results.push({ section: "macOS DNS", status: "FAIL", label: resolverFile, message: "missing", fix: "vdns install" });
  }

  const scutil = await commandExists(execFile, "scutil");
  if (scutil) {
    const result = await execFile("scutil", ["--dns"], 5000);
    results.push({
      section: "macOS DNS",
      status: result.stdout.includes(`domain   : ${tld}`) || result.stdout.includes(`domain : ${tld}`) ? "PASS" : "WARN",
      label: "scutil --dns",
      message: result.stdout.includes(tld) ? `contains ${tld}` : `does not show ${tld}`,
      fix: "sudo killall -HUP mDNSResponder"
    });
  }

  const dscacheutil = await commandExists(execFile, "dscacheutil");
  if (dscacheutil) {
    const domain = ctx.env.VDNS_DOCTOR_A_DOMAIN ?? `google.${tld}`;
    const result = await execFile("dscacheutil", ["-q", "host", "-a", "name", domain], 5000);
    results.push({
      section: "macOS DNS",
      status: result.status === 0 && result.stdout.trim().length > 0 ? "PASS" : "WARN",
      label: "dscacheutil",
      message: result.stdout.trim() || `no host answer for ${domain}`,
      fix: "vdns start"
    });
  }
  return results;
}

async function checkWeb(ctx: DoctorContext, execFile: ExecFile, fetchImpl: FetchLike): Promise<CheckResult[]> {
  const redirectDomain = ctx.env.VDNS_DOCTOR_REDIRECT_DOMAIN ?? `chainvue.${ctx.env.VDNS_TLD ?? "vdns"}`;
  const proxyDomain = ctx.env.VDNS_DOCTOR_PROXY_DOMAIN ?? `verus.${ctx.env.VDNS_TLD ?? "vdns"}`;
  return [
    await checkPort(execFile, "Web gateway", "TCP", "80", "127.0.0.1"),
    await checkRedirect(fetchImpl, redirectDomain),
    await checkProxy(fetchImpl, proxyDomain)
  ];
}

async function checkRedirect(fetchImpl: FetchLike, domain: string): Promise<CheckResult> {
  try {
    const response = await fetchImpl(`http://${domain}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = response.headers.get("location");
    const isRedirect = response.status >= 300 && response.status < 400 && Boolean(location);
    return {
      section: "Web",
      status: isRedirect ? "PASS" : "WARN",
      label: `REDIRECT ${domain}`,
      message: `HTTP ${response.status}${location ? ` Location: ${location}` : ""}`,
      fix: "vdns demo",
      strictFailure: true
    };
  } catch (error) {
    return { section: "Web", status: "WARN", label: `REDIRECT ${domain}`, message: errorMessage(error), fix: "vdns start", strictFailure: true };
  }
}

async function checkProxy(fetchImpl: FetchLike, domain: string): Promise<CheckResult> {
  try {
    const response = await fetchImpl(`http://${domain}`, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const proxy = response.headers.get("x-vdns-proxy");
    const target = response.headers.get("x-vdns-proxy-target-host");
    return {
      section: "Web",
      status: proxy === "1" && target === "verus.io" ? "PASS" : "WARN",
      label: `PROXY ${domain}`,
      message: `HTTP ${response.status} x-vdns-proxy=${proxy ?? ""} x-vdns-proxy-target-host=${target ?? ""}`,
      fix: "Check VDNS_PROXY_ENABLED=true, the PROXY record, and gateway logs.",
      strictFailure: true
    };
  } catch (error) {
    return { section: "Web", status: "WARN", label: `PROXY ${domain}`, message: errorMessage(error), fix: "vdns logs gateway", strictFailure: true };
  }
}

async function checkRecords(ctx: DoctorContext, fetchImpl: FetchLike): Promise<CheckResult[]> {
  const resolverUrl = ctx.env.VDNS_RESOLVER_URL ?? `http://127.0.0.1:${ctx.env.PORT ?? "8080"}`;
  const domains = [
    ["A", ctx.env.VDNS_DOCTOR_A_DOMAIN ?? `google.${ctx.env.VDNS_TLD ?? "vdns"}`],
    ["REDIRECT", ctx.env.VDNS_DOCTOR_REDIRECT_DOMAIN ?? `chainvue.${ctx.env.VDNS_TLD ?? "vdns"}`],
    ["PROXY", ctx.env.VDNS_DOCTOR_PROXY_DOMAIN ?? `verus.${ctx.env.VDNS_TLD ?? "vdns"}`]
  ] as const;
  const results: CheckResult[] = [];
  for (const [type, domain] of domains) {
    try {
      const response = await fetchImpl(`${resolverUrl}/resolve-domain/${domain}`, { signal: AbortSignal.timeout(5000) });
      const body = await response.text();
      results.push({
        section: "Records",
        status: response.ok && body.includes(`"type":"${type}"`) ? "PASS" : "WARN",
        label: domain,
        message: response.ok ? `${type} record ${body.includes(`"type":"${type}"`) ? "found" : "not found"}` : `HTTP ${response.status}`,
        fix: "vdns demo",
        strictFailure: true
      });
    } catch (error) {
      results.push({ section: "Records", status: "WARN", label: domain, message: errorMessage(error), fix: "vdns start", strictFailure: true });
    }
  }
  return results;
}

function checkLogs(ctx: DoctorContext): CheckResult[] {
  const logs = [
    ["resolver", "resolver.launchd.log", "resolver.launchd.err"],
    ["coredns", "coredns.launchd.log", "coredns.launchd.err"],
    ["gateway", "redirect.launchd.log", "redirect.launchd.err"]
  ] as const;
  return logs.map(([name, out, err]) => ({
    section: "Logs",
    status: "PASS",
    label: `${name} logs`,
    message: path.join(ctx.logDir, out),
    details: [path.join(ctx.logDir, err), `Use: vdns logs ${name}`, `Use: vdns logs ${name} --tail`]
  }));
}

async function checkPort(execFile: ExecFile, label: string, protocol: "TCP" | "UDP", port: string, host: string): Promise<CheckResult> {
  if (protocol === "TCP") {
    const connected = await canConnectTcp(host, port);
    return {
      section: port === "80" ? "Web" : "Services",
      status: connected === true ? "PASS" : "WARN",
      label,
      message: connected === true ? `listener reachable on ${host}:${port}` : `no reachable listener on ${host}:${port}`,
      fix: port === "80" ? "vdns start; if root-owned listener is hidden, check vdns logs gateway" : "vdns start"
    };
  }

  const lsof = await commandExists(execFile, "lsof");
  if (!lsof) {
    return { section: "Services", status: "WARN", label, message: "lsof is unavailable" };
  }
  const args = ["-nP", `-iUDP:${port}`];
  const result = await execFile("lsof", args, 3000);
  const visible = result.stdout.includes(`:${port}`) && (result.stdout.includes(host) || result.stdout.includes("*:"));
  return {
    section: "Services",
    status: visible ? "PASS" : "WARN",
    label,
    message: visible ? `listener visible on ${host}:${port}` : `no visible listener on ${host}:${port}`,
    fix: port === "80" ? "vdns start; if root-owned listener is hidden, check vdns logs gateway" : "vdns start"
  };
}

async function canConnectTcp(host: string, port: string): Promise<boolean | "unknown"> {
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return "unknown";
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: parsedPort });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function curlHead(execFile: ExecFile, url: string): Promise<{ status: number; headers: Record<string, string> }> {
  const result = await execFile("curl", ["-I", "--max-time", "20", url], 25_000);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `curl exited ${result.status}`);
  }
  return parseCurlHeaders(result.stdout);
}

function parseCurlHeaders(stdout: string): { status: number; headers: Record<string, string> } {
  const blocks = stdout.trim().split(/\r?\n\r?\n/).filter(Boolean);
  const lines = (blocks.at(-1) ?? "").split(/\r?\n/);
  const status = Number(lines[0]?.match(/^HTTP\/\S+\s+(\d+)/)?.[1] ?? 0);
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return { status, headers };
}

async function commandExists(execFile: ExecFile, command: string): Promise<boolean> {
  const result = await execFile("command", ["-v", command], 1000);
  if (result.status === 0) {
    return true;
  }
  const which = await execFile("which", [command], 1000);
  return which.status === 0;
}

async function checkCaTrusted(execFile: ExecFile): Promise<boolean | "unknown"> {
  const security = await commandExists(execFile, "security");
  if (!security) {
    return "unknown";
  }
  const result = await execFile("security", ["find-certificate", "-a", "-c", "vDNS Local Root CA", "/Library/Keychains/System.keychain"], 3000);
  return result.status === 0 && result.stdout.includes("vDNS Local Root CA");
}

async function defaultExecFile(file: string, args: string[], timeoutMs = 5000): Promise<ExecResult> {
  const { execFile } = await import("node:child_process");
  return new Promise((resolve) => {
    if (file === "command") {
      file = "sh";
      args = ["-c", `command -v "$1"`, "sh", args[1] ?? ""];
    }
    const child = execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const status = typeof (error as { code?: unknown } | null)?.code === "number" ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ status, stdout: String(stdout), stderr: String(stderr) });
    });
    child.on("error", (error) => resolve({ status: 1, stdout: "", stderr: error.message }));
  });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function safeConfigValue(key: string, value: string | undefined): string {
  if (!value) {
    return "";
  }
  if (key === "VERUS_RPC_URL" || key === "VERUS_WRITE_RPC_URL") {
    try {
      return `host=${new URL(value).host}`;
    } catch {
      return "invalid URL";
    }
  }
  return value;
}

function rpcSummary(info: Record<string, unknown>, keys: string[]): string {
  const parts = keys
    .filter((key) => info[key] !== undefined)
    .map((key) => `${key}=${String(info[key])}`);
  return parts.length > 0 ? parts.join(" ") : "response ok";
}

function rpcFailure(label: string, error: unknown): CheckResult {
  return {
    section: "Verus RPC",
    status: "FAIL",
    label,
    message: errorMessage(error),
    fix: "Check VERUS_RPC_URL, rpcbind, rpcallowip, credentials, and whether the Verus node is running and synced."
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
