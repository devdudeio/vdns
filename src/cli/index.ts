#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as processStdin, stdout as processStdout } from "node:process";
import { Command } from "commander";
import { ZodError } from "zod";
import { readFile } from "node:fs/promises";
import {
  extractContentmultimap,
  extractVdnsRecords,
  removeVdnsRecord,
  upsertVdnsRecord
} from "../core/contentmultimap.js";
import {
  deriveParentLookupIdentity,
  deriveUpdateIdentityTarget,
  extractRawIdentityAddress,
  normalizeIdentityNameForUpdate,
  type UpdateIdentityTarget
} from "../core/identityTarget.js";
import { validateRecord } from "../core/records.js";
import type { IdentityPayload, VdnsRecord, VdnsRecordType } from "../core/types.js";
import { extractTxidFromUpdateIdentityResult, waitForTxConfirmation } from "../core/txConfirmation.js";
import { buildUpdateIdentityPayload, type UpdateIdentityPayload } from "../core/updateIdentityPayload.js";
import { buildVdnsVdxfKeyNames, resolveVdnsVdxfIds, type VdnsVdxfIds } from "../core/vdxf.js";
import { buildSiteManifest, inspectSiteManifest, loadSiteManifest, sha256Hex, writeSiteManifest } from "../core/site.js";
import { applyVdnsEnvCompatibility } from "../envCompat.js";
import { VerusRpcClient } from "../rpc/verusRpcClient.js";

type CliIo = {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream;
};

type CliOptions = {
  env?: NodeJS.ProcessEnv;
  io?: CliIo;
  rpcClientFactory?: (options: RpcOptions) => RpcClient;
};

type RpcOptions = {
  url?: string | undefined;
  user?: string | undefined;
  password?: string | undefined;
  timeoutMs?: number | undefined;
};

type RpcClient = {
  getIdentity(identity: string): Promise<IdentityPayload | null>;
  getRawIdentity(identity: string): Promise<unknown | null>;
  getRawTransaction(txid: string, verbose?: boolean): Promise<unknown | null>;
  getVdxfId(key: string): Promise<string>;
  updateIdentity(payload: unknown): Promise<unknown | null>;
};

type VerifyOptions = {
  verify?: boolean;
  confirmations: number;
  verifyTimeoutMs: number;
  verifyIntervalMs: number;
  waitConfirmation?: boolean;
};

class CliExitError extends Error {
  constructor(message: string, readonly exitCode: number) {
    super(message);
    this.name = "CliExitError";
  }
}

export function createCliProgram(options: CliOptions = {}): Command {
  const env = applyVdnsEnvCompatibility({ ...(options.env ?? process.env) });
  const io = options.io ?? { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };
  const rpcClientFactory = options.rpcClientFactory ?? ((rpcOptions) => new VerusRpcClient(cleanRpcOptions(rpcOptions)) as RpcClient);
  const program = new Command();

  program
    .name("vdns")
    .description("Inspect and write vDNS records in VerusID contentmultimap data")
    .option("--rpc-url <url>", "Verus JSON-RPC endpoint URL")
    .option("--rpc-user <user>", "Verus JSON-RPC username")
    .option("--rpc-password <password>", "Verus JSON-RPC password")
    .option("--rpc-timeout-ms <ms>", "Verus JSON-RPC timeout in milliseconds", parsePositiveInt)
    .option("--write-rpc-url <url>", "Verus write JSON-RPC endpoint URL")
    .option("--write-rpc-user <user>", "Verus write JSON-RPC username")
    .option("--write-rpc-password <password>", "Verus write JSON-RPC password")
    .option("--write-rpc-timeout-ms <ms>", "Verus write JSON-RPC timeout in milliseconds", parsePositiveInt)
    .option("--root <identity>", "vDNS root identity")
    .option("--tld <tld>", "vDNS top-level domain")
    .configureOutput({
      writeOut: (str) => io.stdout.write(str),
      writeErr: (str) => io.stderr.write(str)
    });

  const vdxf = program.command("vdxf").description("VDXF helpers");
  addSharedOptions(vdxf
    .command("keys")
    .description("Print vDNS symbolic VDXF keys and resolved IDs when RPC is configured"))
    .action(async () => {
      const global = readGlobalOptions(program, env, vdxf.commands[0]);
      const keyNames = buildVdnsVdxfKeyNames(global.root, global.tld);
      const output: Record<string, unknown> = { root: global.root, tld: global.tld, keyNames };

      if (global.rpc.url) {
        const client = rpcClientFactory(global.rpc);
        output.vdxfIds = await resolveVdnsVdxfIds(client, keyNames);
      }

      writeJson(io, output);
    });

  const identity = program.command("identity").description("Identity helpers");
  addSharedOptions(identity
    .command("raw")
    .description("Fetch and print a raw getidentity response")
    .argument("<identity>"))
    .action(async (identityName: string) => {
      const command = identity.commands[0];
      const client = rpcClientFactory(requireRpcOptions(program, env, command));
      const raw = await client.getRawIdentity(identityName);
      if (raw === null) {
        throw new CliExitError(`Identity not found: ${identityName}`, 2);
      }

      writeJson(io, raw);
    });

  const record = program.command("record").description("vDNS record helpers");
  addSharedOptions(record
    .command("inspect")
    .description("Inspect vDNS records on an identity")
    .argument("<identity>"))
    .action(async (identityName: string) => {
      const command = record.commands.find((candidate) => candidate.name() === "inspect");
      const global = readGlobalOptions(program, env, command);
      const client = rpcClientFactory(requireRpcOptions(program, env, command));
      const targetIdentity = normalizeIdentityNameForUpdate(identityName);
      const identityPayload = await fetchIdentityOrExit(client, targetIdentity);
      const vdxfIds = await resolveIds(client, global.root, global.tld);
      const parsed = extractVdnsRecords(identityPayload, vdxfIds.record, vdxfIds.labels);
      writeJson(io, {
        identity: targetIdentity,
        vdnsRecordKey: vdxfIds.record,
        records: parsed.records,
        warnings: parsed.warnings
      });
    });

  addSharedOptions(record
    .command("set")
    .description("Prepare and write a vDNS record")
    .argument("<identity>")
    .argument("<type>")
    .argument("<name>")
    .argument("<value>"))
    .option("--ttl <seconds>", "record TTL", parsePositiveInt, 300)
    .option("--status <code>", "redirect status for REDIRECT records", parseRedirectStatus, 302)
    .option("--entry <path>", "SITE entry path", "/index.html")
    .option("--sha256 <hash>", "SITE manifest SHA-256")
    .option("-y, --yes", "skip confirmation")
    .option("--verify", "refetch and print vDNS records after updateidentity")
    .option("--confirmations <n>", "confirmations to wait for before --verify", parsePositiveInt, 1)
    .option("--verify-timeout-ms <ms>", "--verify confirmation wait timeout in milliseconds", parsePositiveInt, 180_000)
    .option("--verify-interval-ms <ms>", "--verify confirmation poll interval in milliseconds", parsePositiveInt, 5_000)
    .option("--no-wait-confirmation", "with --verify, refetch immediately without waiting for the update transaction")
    .action(async (identityName: string, typeInput: string, name: string, value: string, commandOptions: {
      ttl: number;
      status: 301 | 302;
      entry: string;
      sha256?: string;
      yes?: boolean;
      verify?: boolean;
      confirmations: number;
      verifyTimeoutMs: number;
      verifyIntervalMs: number;
      waitConfirmation?: boolean;
    }) => {
      const command = record.commands.find((candidate) => candidate.name() === "set");
      const global = readGlobalOptions(program, env, command);
      warnDefaultRootForWrite(io, global);
      const client = rpcClientFactory(requireWriteRpcOptions(program, env, command));
      const targetIdentity = normalizeIdentityNameForUpdate(identityName);
      const recordToWrite = buildRecord(typeInput, name, value, commandOptions.ttl, commandOptions.status, {
        entry: commandOptions.entry,
        ...(commandOptions.sha256 ? { sha256: commandOptions.sha256 } : {})
      });
      const rawIdentity = await fetchRawIdentityOrExit(client, targetIdentity);
      const updateTarget = await deriveCliUpdateTarget(client, targetIdentity, rawIdentity);
      const vdxfIds = await resolveIds(client, global.root, global.tld);
      const currentContentmultimap = extractContentmultimap(rawIdentity);
      const nextContentmultimap = upsertVdnsRecord(currentContentmultimap, vdxfIds, recordToWrite);
      const payload = buildCliUpdatePayload(updateTarget, nextContentmultimap);

      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      writeUpdateTargetPreview(io, updateTarget);
      writeJson(io, payload);
      await confirmOrExit(io, Boolean(commandOptions.yes));
      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      const updateResult = await client.updateIdentity(payload);
      await handlePostUpdateVerify(io, client, targetIdentity, vdxfIds, updateResult, commandOptions);
    });

  addSharedOptions(record
    .command("remove")
    .description("Prepare and remove a vDNS record")
    .argument("<identity>")
    .argument("<type>")
    .argument("<name>"))
    .option("-y, --yes", "skip confirmation")
    .option("--verify", "refetch and print vDNS records after updateidentity")
    .option("--confirmations <n>", "confirmations to wait for before --verify", parsePositiveInt, 1)
    .option("--verify-timeout-ms <ms>", "--verify confirmation wait timeout in milliseconds", parsePositiveInt, 180_000)
    .option("--verify-interval-ms <ms>", "--verify confirmation poll interval in milliseconds", parsePositiveInt, 5_000)
    .option("--no-wait-confirmation", "with --verify, refetch immediately without waiting for the update transaction")
    .action(async (identityName: string, typeInput: string, name: string, commandOptions: {
      yes?: boolean;
      verify?: boolean;
      confirmations: number;
      verifyTimeoutMs: number;
      verifyIntervalMs: number;
      waitConfirmation?: boolean;
    }) => {
      const command = record.commands.find((candidate) => candidate.name() === "remove");
      const global = readGlobalOptions(program, env, command);
      warnDefaultRootForWrite(io, global);
      const client = rpcClientFactory(requireRpcOptions(program, env, command));
      const targetIdentity = normalizeIdentityNameForUpdate(identityName);
      const type = parseRecordType(typeInput);
      const rawIdentity = await fetchRawIdentityOrExit(client, targetIdentity);
      const updateTarget = await deriveCliUpdateTarget(client, targetIdentity, rawIdentity);
      const vdxfIds = await resolveIds(client, global.root, global.tld);
      const currentContentmultimap = extractContentmultimap(rawIdentity);
      const nextContentmultimap = removeVdnsRecord(currentContentmultimap, vdxfIds, type, name);
      const payload = buildCliUpdatePayload(updateTarget, nextContentmultimap);

      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      writeUpdateTargetPreview(io, updateTarget);
      writeJson(io, payload);
      await confirmOrExit(io, Boolean(commandOptions.yes));
      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      const updateResult = await client.updateIdentity(payload);
      await handlePostUpdateVerify(io, client, targetIdentity, vdxfIds, updateResult, commandOptions);
    });

  const site = program.command("site").description("SITE record and manifest helpers");
  site
    .command("build-manifest")
    .description("Build a VDNS_SITE_MANIFEST for a static directory")
    .argument("<dir>")
    .option("--base-uri <uri>", "base HTTP(S) URI for files")
    .option("--local-file-uri", "emit file:// URIs for local testing")
    .option("--entry <path>", "entry path", "/index.html")
    .option("--spa-fallback", "serve entry for unknown paths")
    .option("--out <file>", "write manifest JSON to a file")
    .action(async (dir: string, commandOptions: {
      baseUri?: string;
      localFileUri?: boolean;
      entry: string;
      spaFallback?: boolean;
      out?: string;
    }) => {
      const previous = process.env.VDNS_SITE_ALLOW_FILE_URI;
      if (commandOptions.localFileUri) {
        process.env.VDNS_SITE_ALLOW_FILE_URI = "true";
      }
      try {
        const manifest = await buildSiteManifest(dir, {
          ...(commandOptions.baseUri ? { baseUri: commandOptions.baseUri } : {}),
          ...(commandOptions.localFileUri ? { localFileUri: commandOptions.localFileUri } : {}),
          entry: commandOptions.entry,
          spaFallback: Boolean(commandOptions.spaFallback)
        });
        if (commandOptions.out) {
          await writeSiteManifest(commandOptions.out, manifest);
        } else {
          writeJson(io, manifest);
        }
      } finally {
        if (previous === undefined) {
          delete process.env.VDNS_SITE_ALLOW_FILE_URI;
        } else {
          process.env.VDNS_SITE_ALLOW_FILE_URI = previous;
        }
      }
    });

  site
    .command("inspect-manifest")
    .description("Validate and summarize a SITE manifest")
    .argument("<manifest>")
    .action(async (manifestInput: string) => {
      const manifest = await loadSiteManifest(manifestInput);
      writeJson(io, inspectSiteManifest(manifest));
    });

  addSharedOptions(site
    .command("publish")
    .description("Build a SITE manifest and write a SITE record; does not upload files")
    .argument("<dir>")
    .argument("<identity>")
    .requiredOption("--manifest-uri <uri>", "published manifest URI")
    .option("--manifest-out <file>", "local manifest path to write", "vdns-site-manifest.json")
    .option("--base-uri <uri>", "base HTTP(S) URI for files")
    .option("--entry <path>", "entry path", "/index.html")
    .option("--spa-fallback", "serve entry for unknown paths")
    .option("--ttl <seconds>", "record TTL", parsePositiveInt, 300)
    .option("-y, --yes", "skip confirmation"))
    .action(async (dir: string, identityName: string, commandOptions: {
      manifestUri: string;
      manifestOut: string;
      baseUri?: string;
      entry: string;
      spaFallback?: boolean;
      ttl: number;
      yes?: boolean;
    }) => {
      const command = site.commands.find((candidate) => candidate.name() === "publish");
      const global = readGlobalOptions(program, env, command);
      warnDefaultRootForWrite(io, global);
      const client = rpcClientFactory(requireRpcOptions(program, env, command));
      const targetIdentity = normalizeIdentityNameForUpdate(identityName);
      const manifest = await buildSiteManifest(dir, {
        ...(commandOptions.baseUri ? { baseUri: commandOptions.baseUri } : {}),
        entry: commandOptions.entry,
        spaFallback: Boolean(commandOptions.spaFallback)
      });
      await writeSiteManifest(commandOptions.manifestOut, manifest);
      const manifestBody = await readFile(commandOptions.manifestOut);
      const recordToWrite = buildRecord("SITE", "@", commandOptions.manifestUri, commandOptions.ttl, 302, {
        entry: manifest.entry,
        sha256: sha256Hex(manifestBody)
      });
      const rawIdentity = await fetchRawIdentityOrExit(client, targetIdentity);
      const updateTarget = await deriveCliUpdateTarget(client, targetIdentity, rawIdentity);
      const vdxfIds = await resolveIds(client, global.root, global.tld);
      const nextContentmultimap = upsertVdnsRecord(extractContentmultimap(rawIdentity), vdxfIds, recordToWrite);
      const payload = buildCliUpdatePayload(updateTarget, nextContentmultimap);

      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      writeUpdateTargetPreview(io, updateTarget);
      io.stdout.write(`Manifest: ${commandOptions.manifestOut}\n`);
      writeJson(io, payload);
      await confirmOrExit(io, Boolean(commandOptions.yes));
      assertPayloadTargetsUpdateTarget(payload, updateTarget);
      const updateResult = await client.updateIdentity(payload);
      const txid = extractTxidFromUpdateIdentityResult(updateResult);
      if (txid) {
        io.stdout.write(`Update transaction: ${txid}\n`);
      }
    });

  return program;
}

export async function runCli(argv = process.argv, options: CliOptions = {}): Promise<void> {
  const program = createCliProgram(options);
  try {
    await program.parseAsync(argv);
  } catch (error) {
    const io = options.io ?? { stdout: process.stdout, stderr: process.stderr, stdin: process.stdin };
    const exitCode = error instanceof CliExitError ? error.exitCode : 1;
    const message = error instanceof Error ? error.message : "Unknown CLI error";
    io.stderr.write(`${message}\n`);
    process.exitCode = exitCode;
  }
}

function addSharedOptions(command: Command): Command {
  return command
    .option("--rpc-url <url>", "Verus JSON-RPC endpoint URL")
    .option("--rpc-user <user>", "Verus JSON-RPC username")
    .option("--rpc-password <password>", "Verus JSON-RPC password")
    .option("--rpc-timeout-ms <ms>", "Verus JSON-RPC timeout in milliseconds", parsePositiveInt)
    .option("--write-rpc-url <url>", "Verus write JSON-RPC endpoint URL")
    .option("--write-rpc-user <user>", "Verus write JSON-RPC username")
    .option("--write-rpc-password <password>", "Verus write JSON-RPC password")
    .option("--write-rpc-timeout-ms <ms>", "Verus write JSON-RPC timeout in milliseconds", parsePositiveInt)
    .option("--root <identity>", "vDNS root identity")
    .option("--tld <tld>", "vDNS top-level domain");
}

function readGlobalOptions(program: Command, env: NodeJS.ProcessEnv, command?: Command): {
  root: string;
  tld: string;
  rpc: RpcOptions;
  usedDefaultRoot: boolean;
} {
  const programOptions = program.opts<{
    rpcUrl?: string;
    rpcUser?: string;
    rpcPassword?: string;
    rpcTimeoutMs?: number;
    writeRpcUrl?: string;
    writeRpcUser?: string;
    writeRpcPassword?: string;
    writeRpcTimeoutMs?: number;
    root?: string;
    tld?: string;
  }>();
  const commandOptions = command?.opts<{
    rpcUrl?: string;
    rpcUser?: string;
    rpcPassword?: string;
    rpcTimeoutMs?: number;
    writeRpcUrl?: string;
    writeRpcUser?: string;
    writeRpcPassword?: string;
    writeRpcTimeoutMs?: number;
    root?: string;
    tld?: string;
  }>() ?? {};
  const root = commandOptions.root ?? programOptions.root ?? env.VDNS_ROOT_IDENTITY ?? "fum@";
  const tld = commandOptions.tld ?? programOptions.tld ?? env.VDNS_TLD ?? "vdns";
  return {
    root,
    tld,
    rpc: {
      url: commandOptions.rpcUrl ?? programOptions.rpcUrl ?? env.VERUS_RPC_URL,
      user: commandOptions.rpcUser ?? programOptions.rpcUser ?? env.VERUS_RPC_USER,
      password: commandOptions.rpcPassword ?? programOptions.rpcPassword ?? env.VERUS_RPC_PASSWORD,
      timeoutMs: commandOptions.rpcTimeoutMs ?? programOptions.rpcTimeoutMs ?? envInt(env.VERUS_RPC_TIMEOUT_MS)
    },
    usedDefaultRoot: !commandOptions.root && !programOptions.root && !env.VDNS_ROOT_IDENTITY
  };
}

function readWriteRpcOptions(program: Command, env: NodeJS.ProcessEnv, command?: Command): RpcOptions {
  const programOptions = program.opts<{
    writeRpcUrl?: string;
    writeRpcUser?: string;
    writeRpcPassword?: string;
    writeRpcTimeoutMs?: number;
    rpcUrl?: string;
    rpcUser?: string;
    rpcPassword?: string;
    rpcTimeoutMs?: number;
  }>();
  const commandOptions = command?.opts<{
    writeRpcUrl?: string;
    writeRpcUser?: string;
    writeRpcPassword?: string;
    writeRpcTimeoutMs?: number;
    rpcUrl?: string;
    rpcUser?: string;
    rpcPassword?: string;
    rpcTimeoutMs?: number;
  }>() ?? {};
  return {
    url: commandOptions.writeRpcUrl ?? programOptions.writeRpcUrl ?? env.VERUS_WRITE_RPC_URL ?? commandOptions.rpcUrl ?? programOptions.rpcUrl ?? env.VERUS_RPC_URL,
    user: commandOptions.writeRpcUser ?? programOptions.writeRpcUser ?? env.VERUS_WRITE_RPC_USER ?? commandOptions.rpcUser ?? programOptions.rpcUser ?? env.VERUS_RPC_USER,
    password: commandOptions.writeRpcPassword ?? programOptions.writeRpcPassword ?? env.VERUS_WRITE_RPC_PASSWORD ?? commandOptions.rpcPassword ?? programOptions.rpcPassword ?? env.VERUS_RPC_PASSWORD,
    timeoutMs: commandOptions.writeRpcTimeoutMs ?? programOptions.writeRpcTimeoutMs ?? envInt(env.VERUS_WRITE_RPC_TIMEOUT_MS) ?? commandOptions.rpcTimeoutMs ?? programOptions.rpcTimeoutMs ?? envInt(env.VERUS_RPC_TIMEOUT_MS)
  };
}

function cleanRpcOptions(options: RpcOptions): {
  url?: string;
  user?: string;
  password?: string;
  timeoutMs?: number;
} {
  return Object.fromEntries(
    Object.entries(options).filter((entry): entry is [string, string | number] => entry[1] !== undefined)
  );
}

function requireRpcOptions(program: Command, env: NodeJS.ProcessEnv, command?: Command): RpcOptions {
  const global = readGlobalOptions(program, env, command);
  if (!global.rpc.url) {
    throw new CliExitError("VERUS_RPC_URL or --rpc-url is required for this command", 1);
  }
  return global.rpc;
}

function requireWriteRpcOptions(program: Command, env: NodeJS.ProcessEnv, command?: Command): RpcOptions {
  const rpc = readWriteRpcOptions(program, env, command);
  if (!rpc.url) {
    throw new CliExitError("VERUS_WRITE_RPC_URL or --write-rpc-url is required for write commands", 1);
  }
  return rpc;
}

async function fetchIdentityOrExit(client: RpcClient, identityName: string): Promise<IdentityPayload> {
  const identityPayload = await client.getIdentity(identityName);
  if (!identityPayload) {
    throw new CliExitError(`Identity not found: ${identityName}`, 2);
  }
  return identityPayload;
}

async function fetchRawIdentityOrExit(client: RpcClient, identityName: string): Promise<unknown> {
  const rawIdentity = await client.getRawIdentity(identityName);
  if (!rawIdentity) {
    throw new CliExitError(`Identity not found: ${identityName}`, 2);
  }
  return rawIdentity;
}

async function deriveCliUpdateTarget(
  client: RpcClient,
  targetIdentity: string,
  rawIdentity: unknown
): Promise<UpdateIdentityTarget> {
  const updateTarget = deriveUpdateIdentityTarget(targetIdentity, rawIdentity);
  if (updateTarget.parent || !deriveParentLookupIdentity(targetIdentity)) {
    return updateTarget;
  }

  const parentLookupIdentity = deriveParentLookupIdentity(targetIdentity);
  if (!parentLookupIdentity) {
    return updateTarget;
  }

  const parentRawIdentity = await client.getRawIdentity(parentLookupIdentity);
  const parent = extractRawIdentityAddress(parentRawIdentity);
  if (!parent) {
    throw new CliExitError(
      `Cannot derive parent i-address for ${targetIdentity}; expected parent identity ${parentLookupIdentity} to include identity.identityaddress`,
      1
    );
  }

  return { ...updateTarget, parent };
}

async function resolveIds(client: RpcClient, root: string, tld: string): Promise<VdnsVdxfIds> {
  return resolveVdnsVdxfIds(client, buildVdnsVdxfKeyNames(root, tld));
}

function buildRecord(
  typeInput: string,
  name: string,
  value: string,
  ttl: number,
  status: 301 | 302,
  options: { entry?: string | undefined; sha256?: string | undefined } = {}
): VdnsRecord {
  const type = parseRecordType(typeInput);
  const base = { version: 1 as const, type, name, ttl };
  const candidate = type === "REDIRECT"
    ? { ...base, url: value, status }
    : type === "PROXY"
      ? { ...base, url: value }
      : type === "SITE"
        ? { ...base, manifestUri: value, entry: options.entry ?? "/index.html", ...(options.sha256 ? { sha256: options.sha256 } : {}) }
        : type === "TLSA"
          ? { ...base, sha256: value }
          : { ...base, value };

  try {
    return validateRecord(candidate);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new CliExitError(`Invalid vDNS record: ${error.issues.map((issue) => issue.message).join("; ")}`, 1);
    }
    throw error;
  }
}

function buildCliUpdatePayload(
  updateTarget: UpdateIdentityTarget,
  contentmultimap: Record<string, unknown>
): UpdateIdentityPayload {
  return buildUpdateIdentityPayload({
    updateIdentityName: updateTarget.updateIdentityName,
    ...(updateTarget.parent ? { parent: updateTarget.parent } : {}),
    contentmultimap
  });
}

function parseRecordType(input: string): VdnsRecordType {
  const type = input.toUpperCase();
  if (["A", "AAAA", "CNAME", "TXT", "REDIRECT", "PROXY", "SITE", "TLSA"].includes(type)) {
    return type as VdnsRecordType;
  }
  throw new CliExitError(`Unsupported record type: ${input}`, 1);
}

function parsePositiveInt(input: string): number {
  if (!/^\d+$/.test(input)) {
    throw new Error("must be a positive integer");
  }
  const value = Number(input);
  if (value < 1) {
    throw new Error("must be a positive integer");
  }
  return value;
}

function parseRedirectStatus(input: string): 301 | 302 {
  const status = parsePositiveInt(input);
  if (status !== 301 && status !== 302) {
    throw new Error("must be 301 or 302");
  }
  return status;
}

function envInt(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }
  return parsePositiveInt(input);
}

function writeJson(io: CliIo, value: unknown): void {
  io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function writeUpdateTargetPreview(io: CliIo, updateTarget: UpdateIdentityTarget): void {
  io.stdout.write(`Target identity: ${updateTarget.targetIdentity}\n`);
  io.stdout.write(`Update identity name: ${updateTarget.updateIdentityName}\n`);
  if (updateTarget.parent) {
    io.stdout.write(`Parent: ${updateTarget.parent}\n`);
  }
  if (updateTarget.identityAddress) {
    io.stdout.write(`Identity address: ${updateTarget.identityAddress}\n`);
  }
}

function assertPayloadTargetsUpdateTarget(payload: UpdateIdentityPayload, updateTarget: UpdateIdentityTarget): void {
  if (!updateTarget.updateIdentityName) {
    throw new Error("Refusing to update identity because update identity name is empty");
  }
  if (payload.name !== updateTarget.updateIdentityName) {
    throw new Error("Refusing to update identity because payload.name does not match update identity name");
  }
  if (updateTarget.parent && payload.parent !== updateTarget.parent) {
    throw new Error("Refusing to update identity because payload.parent does not match target parent");
  }
}

async function confirmOrExit(io: CliIo, yes: boolean): Promise<void> {
  if (yes) {
    return;
  }

  const readline = createInterface({ input: io.stdin, output: io.stdout });
  try {
    const answer = await readline.question("Continue? [y/N] ");
    if (answer.trim().toLowerCase() !== "y") {
      throw new CliExitError("Aborted", 1);
    }
  } finally {
    readline.close();
  }
}

async function maybeVerify(
  io: CliIo,
  client: RpcClient,
  identityName: string,
  vdxfIds: VdnsVdxfIds,
  verify: boolean
): Promise<void> {
  if (!verify) {
    return;
  }

  io.stdout.write(`Verifying target identity: ${identityName}\n`);
  const identityPayload = await fetchIdentityOrExit(client, identityName);
  const parsed = extractVdnsRecords(identityPayload, vdxfIds.record, vdxfIds.labels);
  writeJson(io, {
    identity: identityName,
    vdnsRecordKey: vdxfIds.record,
    records: parsed.records,
    warnings: parsed.warnings
  });
}

async function handlePostUpdateVerify(
  io: CliIo,
  client: RpcClient,
  targetIdentity: string,
  vdxfIds: VdnsVdxfIds,
  updateResult: unknown,
  options: VerifyOptions
): Promise<void> {
  const txid = extractTxidFromUpdateIdentityResult(updateResult);
  if (txid) {
    io.stdout.write(`Update transaction: ${txid}\n`);
  }

  if (!options.verify) {
    return;
  }

  if (options.waitConfirmation === false) {
    io.stderr.write("Warning: verifying immediately without waiting for confirmation; getidentity state may be stale.\n");
    await maybeVerify(io, client, targetIdentity, vdxfIds, true);
    return;
  }

  if (!txid) {
    throw new CliExitError("Unable to extract updateidentity transaction id; cannot wait for confirmation before verify", 1);
  }

  io.stdout.write(`Waiting for update transaction ${txid} to reach ${options.confirmations} confirmation(s)...\n`);
  const confirmations = await waitForTxConfirmation(client, {
    txid,
    confirmations: options.confirmations,
    timeoutMs: options.verifyTimeoutMs,
    intervalMs: options.verifyIntervalMs
  });
  io.stdout.write(`Update transaction confirmed: ${txid} (${confirmations} confirmation(s))\n`);
  await maybeVerify(io, client, targetIdentity, vdxfIds, true);
}

function warnDefaultRootForWrite(io: CliIo, global: { root: string; usedDefaultRoot: boolean }): void {
  if (global.usedDefaultRoot && global.root === "fum@") {
    io.stderr.write("Warning: using default vDNS root identity fum@. Set --root or VDNS_ROOT_IDENTITY to override.\n");
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runCli(process.argv, { io: { stdout: processStdout, stderr: process.stderr, stdin: processStdin } });
}
