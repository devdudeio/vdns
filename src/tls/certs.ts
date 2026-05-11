import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { deriveTlsPaths, hostCertPaths, type VdnsTlsPaths } from "./paths.js";
import { normalizeVdnsTlsHost } from "./hosts.js";

const execFileAsync = promisify(execFile);
const opensslRequiredMessage = "OpenSSL is required for HTTPS certificate generation.";

export type InitCaOptions = {
  force?: boolean;
  paths?: VdnsTlsPaths;
  hostname?: string;
};

export type GenerateCertOptions = {
  force?: boolean;
  tld?: string;
  validityDays?: number;
  paths?: VdnsTlsPaths;
};

export async function ensureOpenSsl(): Promise<void> {
  try {
    await execFileAsync("openssl", ["version"]);
  } catch {
    throw new Error(opensslRequiredMessage);
  }
}

export async function initCa(options: InitCaOptions = {}): Promise<VdnsTlsPaths> {
  await ensureOpenSsl();
  const paths = options.paths ?? deriveTlsPaths();
  await mkdir(paths.caDir, { recursive: true, mode: 0o700 });
  await chmod(paths.caDir, 0o700);
  if (!options.force && await fileExists(paths.caCert) && await fileExists(paths.caKey)) {
    return paths;
  }
  if (!options.force && (await fileExists(paths.caCert) || await fileExists(paths.caKey))) {
    throw new Error("CA files already exist. Use --force to replace them.");
  }

  const cn = `vDNS Local Root CA (${options.hostname ?? os.hostname()})`;
  await execFileAsync("openssl", [
    "req",
    "-x509",
    "-newkey", "rsa:4096",
    "-sha256",
    "-days", "1825",
    "-nodes",
    "-addext", "basicConstraints=critical,CA:TRUE,pathlen:0",
    "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    "-addext", "subjectKeyIdentifier=hash",
    "-subj", `/CN=${escapeOpenSslSubject(cn)}`,
    "-keyout", paths.caKey,
    "-out", paths.caCert
  ]);
  await chmod(paths.caKey, 0o600);
  await chmod(paths.caDir, 0o700);
  return paths;
}

export async function generateHostCert(host: string, options: GenerateCertOptions = {}): Promise<{ hostname: string; cert: string; key: string }> {
  await ensureOpenSsl();
  const tld = options.tld ?? "vrsc";
  const hostname = normalizeVdnsTlsHost(host, tld);
  if (hostname instanceof Error) {
    throw hostname;
  }
  const paths = options.paths ?? deriveTlsPaths();
  if (!await fileExists(paths.caCert) || !await fileExists(paths.caKey)) {
    throw new Error("Missing vDNS local root CA. Run: vdns https init-ca");
  }

  const certPaths = hostCertPaths(paths, hostname);
  await mkdir(certPaths.dir, { recursive: true, mode: 0o700 });
  await chmod(certPaths.dir, 0o700);
  if (!options.force && await certUsable(certPaths.cert, certPaths.key, hostname)) {
    return { hostname, cert: certPaths.cert, key: certPaths.key };
  }

  const tmp = await mkdir(path.join(paths.stateDir, "tmp"), { recursive: true }).then(() => path.join(paths.stateDir, "tmp"));
  const csr = path.join(tmp, `${hostname}.csr`);
  const ext = path.join(tmp, `${hostname}.ext`);
  await rm(csr, { force: true });
  await rm(ext, { force: true });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(ext, [
    "basicConstraints=CA:FALSE",
    "keyUsage=digitalSignature,keyEncipherment",
    "extendedKeyUsage=serverAuth",
    `subjectAltName=DNS:${hostname}`
  ].join("\n")));

  await execFileAsync("openssl", [
    "req",
    "-new",
    "-newkey", "rsa:2048",
    "-nodes",
    "-subj", `/CN=${escapeOpenSslSubject(hostname)}`,
    "-keyout", certPaths.key,
    "-out", csr
  ]);
  await chmod(certPaths.key, 0o600);
  await execFileAsync("openssl", [
    "x509",
    "-req",
    "-in", csr,
    "-CA", paths.caCert,
    "-CAkey", paths.caKey,
    "-CAcreateserial",
    "-out", certPaths.cert,
    "-days", String(options.validityDays ?? 397),
    "-sha256",
    "-extfile", ext
  ]);
  await rm(csr, { force: true });
  await rm(ext, { force: true });
  return { hostname, cert: certPaths.cert, key: certPaths.key };
}

export async function removeHostCert(host: string, tld = "vrsc", paths = deriveTlsPaths()): Promise<boolean> {
  const hostname = normalizeVdnsTlsHost(host, tld);
  if (hostname instanceof Error) {
    throw hostname;
  }
  const certPaths = hostCertPaths(paths, hostname);
  const existed = await fileExists(certPaths.dir);
  await rm(certPaths.dir, { recursive: true, force: true });
  return existed;
}

export async function listHostCerts(paths = deriveTlsPaths()): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(paths.certDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

export async function readHostSecureContext(hostname: string, options: GenerateCertOptions = {}): Promise<{ cert: Buffer; key: Buffer }> {
  const generated = await generateHostCert(hostname, options);
  return {
    cert: await readFile(generated.cert),
    key: await readFile(generated.key)
  };
}

export async function caStatus(paths = deriveTlsPaths()): Promise<{
  paths: VdnsTlsPaths;
  caCertExists: boolean;
  caKeyExists: boolean;
  caKeySafe: boolean | null;
  certCount: number;
}> {
  const caCertExists = await fileExists(paths.caCert);
  const caKeyExists = await fileExists(paths.caKey);
  let caKeySafe: boolean | null = null;
  if (caKeyExists) {
    const mode = (await stat(paths.caKey)).mode & 0o777;
    caKeySafe = (mode & 0o077) === 0;
  }
  return {
    paths,
    caCertExists,
    caKeyExists,
    caKeySafe,
    certCount: (await listHostCerts(paths)).length
  };
}

async function certUsable(cert: string, key: string, hostname: string): Promise<boolean> {
  if (!await fileExists(cert) || !await fileExists(key)) {
    return false;
  }
  try {
    await access(key, constants.R_OK);
    await execFileAsync("openssl", ["x509", "-checkend", String(30 * 24 * 60 * 60), "-noout", "-in", cert]);
    const { stdout } = await execFileAsync("openssl", ["x509", "-in", cert, "-noout", "-ext", "subjectAltName"]);
    return stdout.includes(`DNS:${hostname}`);
  } catch {
    return false;
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function escapeOpenSslSubject(value: string): string {
  return value.replace(/[\\/]/g, "\\$&");
}
