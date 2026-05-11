import { execFile } from "node:child_process";
import net from "node:net";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import { loadEnvFiles } from "./env.js";
import { applyVdnsEnvCompatibility } from "./envCompat.js";
import { caStatus, generateHostCert, initCa, listHostCerts, removeHostCert } from "./tls/certs.js";
import { deriveTlsPaths } from "./tls/paths.js";

const execFileAsync = promisify(execFile);

function usage(): string {
  return `vdns https <command>

Commands:
  init-ca [--force]              Create the local vDNS root CA
  install-ca                     Trust the local CA for SSL/TLS on macOS
  uninstall-ca [--delete-files]  Remove CA trust and optionally local files
  status                         Show CA, cache, env, trust, and port status
  verify                         Verify the HTTPS lifecycle end to end
  generate-cert <host> [--force] Generate or refresh a host certificate
  remove-cert <host>             Remove a cached host certificate
  list-certs                     List cached host certificates
`;
}

async function main(): Promise<void> {
  loadEnvFiles();
  applyVdnsEnvCompatibility(process.env);
  const args = process.argv.slice(2);
  const command = args[0] ?? "--help";
  if (command === "-h" || command === "--help" || command === "help") {
    process.stdout.write(usage());
    return;
  }

  if (command === "init-ca") {
    const paths = await initCa({ force: args.includes("--force") });
    process.stdout.write(`Created vDNS local root CA at ${paths.caCert}\n`);
    process.stdout.write("Next step: vdns https install-ca\n");
    return;
  }

  if (command === "generate-cert") {
    const host = args[1];
    if (!host) {
      throw new Error("Usage: vdns https generate-cert <host> [--force]");
    }
    const generated = await generateHostCert(host, {
      force: args.includes("--force"),
      tld: process.env.VDNS_TLS_TLD ?? process.env.VDNS_TLD ?? "vdns",
      validityDays: Number(process.env.VDNS_TLS_CERT_VALIDITY_DAYS ?? 397)
    });
    process.stdout.write(`Generated certificate for ${generated.hostname}\n`);
    process.stdout.write(`${generated.cert}\n`);
    return;
  }

  if (command === "remove-cert") {
    const host = args[1];
    if (!host) {
      throw new Error("Usage: vdns https remove-cert <host>");
    }
    const removed = await removeHostCert(host, process.env.VDNS_TLS_TLD ?? process.env.VDNS_TLD ?? "vdns");
    process.stdout.write(removed ? `Removed cached certificate for ${host}\n` : `No cached certificate for ${host}\n`);
    return;
  }

  if (command === "list-certs") {
    const certs = await listHostCerts();
    process.stdout.write(certs.length > 0 ? `${certs.join("\n")}\n` : "No cached certificates.\n");
    return;
  }

  if (command === "install-ca") {
    await installCa();
    return;
  }

  if (command === "uninstall-ca") {
    await uninstallCa(args.includes("--delete-files"));
    return;
  }

  if (command === "status") {
    await printStatus();
    return;
  }

  if (command === "verify") {
    const ok = await verifyHttps();
    process.exitCode = ok ? 0 : 1;
    return;
  }

  throw new Error(`Unknown https command: ${command}`);
}

async function installCa(): Promise<void> {
  requireMacos();
  const paths = deriveTlsPaths();
  const status = await caStatus(paths);
  if (!status.caCertExists) {
    throw new Error("Missing CA certificate. Run: vdns https init-ca");
  }
  process.stdout.write("Trust warning: this installs a local-only vDNS root CA for SSL/TLS on this Mac.\n");
  await execFileAsync("security", [
    "add-trusted-cert",
    "-d",
    "-r", "trustRoot",
    "-p", "ssl",
    "-k", "/Library/Keychains/System.keychain",
    paths.caCert
  ]);
  process.stdout.write("Installed vDNS local root CA into the macOS System keychain.\n");
}

async function uninstallCa(deleteFiles: boolean): Promise<void> {
  requireMacos();
  const paths = deriveTlsPaths();
  const fingerprint = await caFingerprint(paths.caCert);
  if (fingerprint) {
    try {
      await execFileAsync("security", ["delete-certificate", "-Z", fingerprint, "/Library/Keychains/System.keychain"]);
      process.stdout.write("Removed vDNS local root CA trust from the macOS System keychain.\n");
    } catch {
      process.stdout.write("No vDNS local root CA trust entry found in the macOS System keychain.\n");
    }
  } else {
    process.stdout.write("No local CA certificate file found.\n");
  }
  if (deleteFiles) {
    await rm(paths.caDir, { recursive: true, force: true });
    await rm(paths.certDir, { recursive: true, force: true });
    process.stdout.write("Deleted local CA files and generated certificate cache.\n");
  }
}

async function printStatus(): Promise<void> {
  const status = await caStatus();
  const trusted = process.platform === "darwin" && status.caCertExists ? await isCaTrusted(status.paths.caCert) : "unknown";
  const port443 = await listenerStatus(process.env.VDNS_HTTPS_HOST ?? "127.0.0.1", process.env.VDNS_HTTPS_PORT ?? "443");
  process.stdout.write([
    `HTTPS env enabled: ${(process.env.VDNS_HTTPS_ENABLED ?? "false").toLowerCase() === "true"}`,
    `CA cert: ${status.caCertExists ? status.paths.caCert : "missing"}`,
    `CA key: ${status.caKeyExists ? status.paths.caKey : "missing"}`,
    `CA key permissions safe: ${status.caKeySafe === null ? "unknown" : status.caKeySafe}`,
    `macOS CA trusted: ${trusted}`,
    `cert cache count: ${status.certCount}`,
    `port 443 listener: ${port443}`
  ].join("\n") + "\n");
}

async function verifyHttps(): Promise<boolean> {
  const checks: Array<{ label: string; ok: boolean; message: string }> = [];
  const status = await caStatus();
  const enabled = (process.env.VDNS_HTTPS_ENABLED ?? "false").toLowerCase() === "true";
  const proxyDomain = process.env.VDNS_DOCTOR_PROXY_DOMAIN ?? `verus.${process.env.VDNS_TLD ?? "vdns"}`;
  const redirectDomain = process.env.VDNS_DOCTOR_REDIRECT_DOMAIN ?? `chainvue.${process.env.VDNS_TLD ?? "vdns"}`;
  const aDomain = process.env.VDNS_DOCTOR_A_DOMAIN ?? proxyDomain;

  checks.push({ label: "CA cert", ok: status.caCertExists, message: status.caCertExists ? status.paths.caCert : "missing" });
  checks.push({ label: "CA key", ok: status.caKeyExists, message: status.caKeyExists ? status.paths.caKey : "missing" });
  checks.push({ label: "CA key permissions", ok: status.caKeySafe === true, message: `safe=${status.caKeySafe}` });
  const trusted = process.platform === "darwin" && status.caCertExists ? await isCaTrusted(status.paths.caCert) : false;
  checks.push({ label: "macOS CA trust", ok: trusted === true, message: `trusted=${trusted}` });
  checks.push({ label: "VDNS_HTTPS_ENABLED", ok: enabled, message: `enabled=${enabled}` });
  checks.push({
    label: "port 443 listener",
    ok: await listenerStatus(process.env.VDNS_HTTPS_HOST ?? "127.0.0.1", process.env.VDNS_HTTPS_PORT ?? "443") === "running",
    message: "listener check"
  });

  checks.push(await verifyCurl(`https://${proxyDomain}`, "trusted HTTPS proxy", (response) =>
    response.headers["x-vdns-proxy"] === "1" && response.headers["x-vdns-proxy-target-host"] === "verus.io"));
  checks.push(await verifyCurl(`http://${aDomain}`, "HTTP still works", (response) => response.status < 500));
  checks.push(await verifyCurl(`http://${redirectDomain}`, "HTTP REDIRECT still works", (response) => response.status >= 300 && response.status < 400));
  checks.push(await verifyCurl(`https://${redirectDomain}`, "HTTPS REDIRECT works", (response) => response.status >= 300 && response.status < 400));

  for (const check of checks) {
    process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.label}: ${check.message}\n`);
  }
  return checks.every((check) => check.ok);
}

async function verifyCurl(
  url: string,
  label: string,
  predicate: (response: { status: number; headers: Record<string, string> }) => boolean
): Promise<{ label: string; ok: boolean; message: string }> {
  try {
    const { stdout } = await execFileAsync("curl", ["-I", "--max-time", "20", url], { timeout: 25_000 });
    const response = parseCurlHeaders(stdout);
    const ok = predicate(response);
    return {
      label,
      ok,
      message: `HTTP ${response.status} x-vdns-proxy=${response.headers["x-vdns-proxy"] ?? ""} x-vdns-proxy-target-host=${response.headers["x-vdns-proxy-target-host"] ?? ""}`
    };
  } catch (error) {
    return { label, ok: false, message: error instanceof Error ? error.message : String(error) };
  }
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

async function caFingerprint(cert: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("openssl", ["x509", "-in", cert, "-noout", "-fingerprint", "-sha1"]);
    return stdout.trim().split("=")[1]?.replaceAll(":", "") ?? null;
  } catch {
    return null;
  }
}

async function isCaTrusted(cert: string): Promise<boolean | "unknown"> {
  const fingerprint = await caFingerprint(cert);
  if (!fingerprint) {
    return false;
  }
  try {
    await execFileAsync("security", ["find-certificate", "-Z", "-a", "-c", "vDNS Local Root CA", "/Library/Keychains/System.keychain"]);
    return true;
  } catch {
    return false;
  }
}

async function listenerStatus(host: string, port: string): Promise<"running" | "not running" | "unknown"> {
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return "unknown";
  }
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port: parsedPort });
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve("running");
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve("not running");
    });
    socket.once("error", () => resolve("not running"));
  });
}

function requireMacos(): void {
  if (process.platform !== "darwin") {
    throw new Error("This command is macOS-only.");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
