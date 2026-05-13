import { PassThrough, Readable } from "node:stream";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runCli } from "../src/cli/index.js";
import { decodeJsonObjectData } from "../src/core/objectDataCodec.js";
import type { IdentityPayload } from "../src/core/types.js";

type MockRpcClient = {
  getIdentity: ReturnType<typeof vi.fn<[string], Promise<IdentityPayload | null>>>;
  getRawIdentity: ReturnType<typeof vi.fn<[string], Promise<unknown | null>>>;
  getRawTransaction: ReturnType<typeof vi.fn<[string, boolean?], Promise<unknown | null>>>;
  getVdxfId: ReturnType<typeof vi.fn<[string], Promise<string>>>;
  updateIdentity: ReturnType<typeof vi.fn<[unknown], Promise<unknown | null>>>;
};

type CapturedPassThrough = PassThrough & { capturedChunks: Buffer[] };

function makeCapturedPassThrough(): CapturedPassThrough {
  const stream = new PassThrough() as CapturedPassThrough;
  stream.capturedChunks = [];
  stream.on("data", (chunk: Buffer | string) => {
    stream.capturedChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return stream;
}

function makeIo(stdinText = ""): {
  stdout: CapturedPassThrough;
  stderr: CapturedPassThrough;
  stdin: Readable;
} {
  return {
    stdout: makeCapturedPassThrough(),
    stderr: makeCapturedPassThrough(),
    stdin: Readable.from([stdinText])
  };
}

function streamText(stream: CapturedPassThrough): string {
  return Buffer.concat(stream.capturedChunks).toString("utf8");
}

function parseJsonOutputs(stdout: string): Array<Record<string, any>> {
  const cleaned = stdout
    .split("\n")
    .filter((line) => ![
      "Target identity: ",
      "Update identity name: ",
      "Parent: ",
      "Identity address: ",
      "Update transaction: ",
      "Waiting for update transaction ",
      "Update transaction confirmed: ",
      "Verifying target identity: "
    ].some((prefix) => line.startsWith(prefix)))
    .join("\n")
    .trim();

  if (!cleaned) {
    return [];
  }

  return cleaned.split(/\n(?=\{)/).map((chunk) => JSON.parse(chunk));
}

function makeClient(identity: IdentityPayload | null = { identity: "dude@", contentmultimap: {} }): MockRpcClient {
  return {
    getIdentity: vi.fn(async () => identity),
    getRawIdentity: vi.fn(async () => identity),
    getRawTransaction: vi.fn(async () => ({ confirmations: 1 })),
    getVdxfId: vi.fn(async (key: string) => `id:${key}`),
    updateIdentity: vi.fn(async () => ({ txid: "tx" }))
  };
}

async function run(args: string[], client = makeClient(), env: NodeJS.ProcessEnv = { VERUS_RPC_URL: "http://127.0.0.1:27486" }) {
  const io = makeIo();
  const rpcClientFactory = vi.fn(() => client);
  process.exitCode = undefined;

  await runCli(["node", "vdns", ...args], { env, io, rpcClientFactory });

  return {
    client,
    rpcClientFactory,
    stdout: streamText(io.stdout),
    stderr: streamText(io.stderr),
    exitCode: process.exitCode
  };
}

describe("vdns CLI", () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  it("prints VDXF keys with command-local root and tld options without RPC", async () => {
    const result = await run(["vdxf", "keys", "--root", "dude@", "--tld", "vdns"], makeClient(), {});
    const payload = JSON.parse(result.stdout);

    expect(payload.keyNames.record).toBe("dude.vdns::vdns.record");
    expect(payload.vdxfIds).toBeUndefined();
    expect(result.rpcClientFactory).not.toHaveBeenCalled();
    expect(result.exitCode).toBeUndefined();
  });

  it("fails fast without an RPC URL for RPC commands", async () => {
    const result = await run(["identity", "raw", "dude@"], makeClient(), {});

    expect(result.stderr).toContain("VERUS_RPC_URL or --rpc-url is required");
    expect(result.rpcClientFactory).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(1);
  });

  it("loads the configured vDNS env file for RPC commands", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "vdns-cli-"));
    try {
      const envFile = path.join(tempDir, ".env.local");
      await writeFile(envFile, [
        "VERUS_RPC_URL=http://127.0.0.1:18843",
        "VDNS_ROOT_IDENTITY=dude@",
        "VDNS_TLD=vdns"
      ].join("\n"));
      const result = await run(["identity", "raw", "dude@"], makeClient(), { VDNS_ENV_FILE: envFile });

      expect(result.rpcClientFactory).toHaveBeenCalledWith({
        url: "http://127.0.0.1:18843",
        user: undefined,
        password: undefined,
        timeoutMs: undefined
      });
      expect(result.exitCode).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("exits 2 for missing raw identities", async () => {
    const client = makeClient(null);
    const result = await run(["identity", "raw", "missing@"], client);

    expect(result.stderr).toContain("Identity not found: missing@");
    expect(result.exitCode).toBe(2);
  });

  it("uses fum@ as the default root for write commands", async () => {
    const client = makeClient({
      identity: "dude@",
      contentmultimap: {}
    });
    const result = await run([
      "record",
      "set",
      "dude@",
      "TXT",
      "@",
      "hello",
      "--yes"
    ], client);
    const payload = parseJsonOutputs(result.stdout)[0];

    expect(Object.keys(payload.contentmultimap)).toContain("id:fum.vdns::vdns.record");
    expect(result.stderr).toContain("Warning: using default vDNS root identity fum@");
    expect(result.exitCode).toBeUndefined();
  });

  it("uses VERUS_WRITE_RPC_URL for write commands", async () => {
    const client = makeClient({ identity: "dude@", contentmultimap: {} });
    const result = await run([
      "record",
      "set",
      "dude@",
      "TXT",
      "@",
      "hello",
      "--root",
      "dude@",
      "--yes"
    ], client, {
      VERUS_RPC_URL: "https://api.verustest.net/",
      VERUS_WRITE_RPC_URL: "http://127.0.0.1:18843",
      VERUS_WRITE_RPC_USER: "writer",
      VERUS_WRITE_RPC_PASSWORD: "secret"
    });

    expect(result.rpcClientFactory).toHaveBeenCalledWith(expect.objectContaining({
      url: "http://127.0.0.1:18843",
      user: "writer",
      password: "secret"
    }));
    expect(result.exitCode).toBeUndefined();
  });

  it("sets records with --yes by fetching first, merging, previewing, and updating", async () => {
    const client = makeClient({
      identity: "dude@",
      contentmultimap: { unrelated: ["keep"] }
    });
    const result = await run([
      "record",
      "set",
      "dude@",
      "A",
      "@",
      "192.0.2.10",
      "--root",
      "dude@",
      "--yes"
    ], client);
    const payload = parseJsonOutputs(result.stdout)[0];

    expect(client.getRawIdentity).toHaveBeenCalledWith("dude@");
    expect(client.updateIdentity).toHaveBeenCalledWith(payload);
    expect(result.stdout).toContain("Target identity: dude@");
    expect(result.stdout).toContain("Update identity name: dude@");
    expect(payload.contentmultimap.unrelated).toEqual(["keep"]);
    const descriptor = payload.contentmultimap["id:dude.vdns::vdns.record"][0].i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv;
    expect(descriptor).toMatchObject({
      label: "id:dude.vdns::vdns.dns.a",
      mimetype: "application/json"
    });
    expect(typeof descriptor.objectdata).toBe("string");
    expect(decodeJsonObjectData(descriptor.objectdata).value).toEqual({
      version: 1,
      type: "A",
      name: "@",
      value: "192.0.2.10",
      ttl: 300
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("sets PROXY records with --yes", async () => {
    const client = makeClient({ identity: "dude@", contentmultimap: {} });
    const result = await run([
      "record",
      "set",
      "dude@",
      "PROXY",
      "@",
      "https://verus.io/",
      "--root",
      "dude@",
      "--yes"
    ], client);
    const payload = parseJsonOutputs(result.stdout)[0];
    const descriptor = payload.contentmultimap["id:dude.vdns::vdns.record"][0].i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv;

    expect(descriptor.label).toBe("id:dude.vdns::vdns.web.proxy");
    expect(decodeJsonObjectData(descriptor.objectdata).value).toEqual({
      version: 1,
      type: "PROXY",
      name: "@",
      url: "https://verus.io/",
      ttl: 300
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("sets SITE records with --yes", async () => {
    const client = makeClient({ identity: "dude@", contentmultimap: {} });
    const result = await run([
      "record",
      "set",
      "dude@",
      "SITE",
      "@",
      "https://cdn.example/manifest.json",
      "--entry",
      "/index.html",
      "--sha256",
      "a".repeat(64),
      "--root",
      "dude@",
      "--yes"
    ], client);
    const payload = parseJsonOutputs(result.stdout)[0];
    const descriptor = payload.contentmultimap["id:dude.vdns::vdns.record"][0].i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv;

    expect(descriptor.label).toBe("id:dude.vdns::vdns.web.site");
    expect(decodeJsonObjectData(descriptor.objectdata).value).toEqual({
      version: 1,
      type: "SITE",
      name: "@",
      entry: "/index.html",
      manifestUri: "https://cdn.example/manifest.json",
      sha256: "a".repeat(64),
      ttl: 300
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("builds SITE manifests from static directories", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "vdns-site-cli-"));
    try {
      await mkdir(path.join(dir, "assets"));
      await writeFile(path.join(dir, "index.html"), "<main>home</main>");
      await writeFile(path.join(dir, "assets", "app.js"), "console.log('ok');");
      await writeFile(path.join(dir, ".DS_Store"), "ignored");

      const result = await run(["site", "build-manifest", dir, "--base-uri", "https://cdn.example/site/", "--spa-fallback"], makeClient(), {});
      const manifest = JSON.parse(result.stdout);

      expect(manifest.type).toBe("VDNS_SITE_MANIFEST");
      expect(manifest.entry).toBe("/index.html");
      expect(manifest.spaFallback).toBe(true);
      expect(manifest.files.map((file: { path: string }) => file.path)).toEqual(["/assets/app.js", "/index.html"]);
      expect(manifest.files.find((file: { path: string }) => file.path === "/assets/app.js").mime).toContain("text/javascript");
      expect(result.exitCode).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not call updateidentity when validation fails", async () => {
    const client = makeClient();
    const result = await run(["record", "set", "dude@", "A", "@", "not-an-ip", "--yes"], client);

    expect(client.getIdentity).not.toHaveBeenCalled();
    expect(client.updateIdentity).not.toHaveBeenCalled();
    expect(result.stderr).toContain("Invalid vDNS record");
    expect(result.exitCode).toBe(1);
  });

  it("removes records with --yes and supports verify output", async () => {
    const client = makeClient({
      identity: "dude@",
      contentmultimap: {
        "id:dude.vdns::vdns.record": [
          { version: 1, type: "TXT", name: "@", value: "remove", ttl: 300 },
          { version: 1, type: "TXT", name: "keep", value: "stay", ttl: 300 }
        ]
      }
    });
    const result = await run([
      "record",
      "remove",
      "dude@",
      "TXT",
      "@",
      "--root",
      "dude@",
      "--yes",
      "--verify"
    ], client);
    const jsonOutputs = parseJsonOutputs(result.stdout);

    expect(client.updateIdentity).toHaveBeenCalledWith(jsonOutputs[0]);
    expect(client.getRawTransaction).toHaveBeenCalledWith("tx", true);
    expect(jsonOutputs[0].contentmultimap["id:dude.vdns::vdns.record"]).toEqual([
      { version: 1, type: "TXT", name: "keep", value: "stay", ttl: 300 }
    ]);
    expect(jsonOutputs[1]).toMatchObject({
      identity: "dude@",
      vdnsRecordKey: "id:dude.vdns::vdns.record"
    });
    expect(result.stdout).toContain("Update transaction: tx");
    expect(result.stdout).toContain("Waiting for update transaction tx to reach 1 confirmation(s)");
    expect(result.stdout).toContain("Verifying target identity: dude@");
    expect(result.exitCode).toBeUndefined();
  });

  it("sets a namespaced identity using local name and parent while verifying the full target", async () => {
    const client = makeClient({
      identity: "chainvue@",
      contentmultimap: { unrelated: ["keep"] }
    });
    client.getRawIdentity.mockResolvedValue({
      result: {
        identity: {
          name: "chainvue",
          parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
          identityaddress: "i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS",
          contentmultimap: { unrelated: ["keep"] }
        }
      }
    });
    const result = await run([
      "record",
      "set",
      "chainvue.fum@",
      "REDIRECT",
      "@",
      "http://chainvue.io/",
      "--root",
      "fum@",
      "--yes",
      "--verify"
    ], client);
    const jsonOutputs = parseJsonOutputs(result.stdout);
    const payload = jsonOutputs[0];
    const verifyOutput = jsonOutputs[1];

    expect(client.getRawIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(client.getIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(client.getRawTransaction).toHaveBeenCalledWith("tx", true);
    expect(client.updateIdentity).toHaveBeenCalledWith(payload);
    expect(payload).toMatchObject({
      name: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe"
    });
    expect(result.stdout).toContain("Target identity: chainvue.fum@");
    expect(result.stdout).toContain("Update identity name: chainvue");
    expect(result.stdout).toContain("Verifying target identity: chainvue.fum@");
    expect(result.stdout).toContain("Parent: i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe");
    expect(result.stdout).toContain("Identity address: i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS");
    expect(verifyOutput).toMatchObject({
      identity: "chainvue.fum@",
      vdnsRecordKey: "id:fum.vdns::vdns.record"
    });
    expect(verifyOutput.identity).not.toBe("chainvue@");
    expect(result.exitCode).toBeUndefined();
  });

  it("removes a namespaced identity using local name and parent while verifying the full target", async () => {
    const client = makeClient({
      identity: "chainvue@",
      contentmultimap: {
        "id:fum.vdns::vdns.record": [
          { version: 1, type: "REDIRECT", name: "@", url: "http://chainvue.io/", status: 302, ttl: 300 },
          { version: 1, type: "TXT", name: "keep", value: "stay", ttl: 300 }
        ]
      }
    });
    client.getRawIdentity.mockResolvedValue({
      result: {
        identity: {
          name: "chainvue",
          parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
          contentmultimap: {
            "id:fum.vdns::vdns.record": [
              { version: 1, type: "REDIRECT", name: "@", url: "http://chainvue.io/", status: 302, ttl: 300 },
              { version: 1, type: "TXT", name: "keep", value: "stay", ttl: 300 }
            ]
          }
        }
      }
    });
    const result = await run([
      "record",
      "remove",
      "chainvue.fum@",
      "REDIRECT",
      "@",
      "--root",
      "fum@",
      "--yes",
      "--verify"
    ], client);
    const jsonOutputs = parseJsonOutputs(result.stdout);
    const payload = jsonOutputs[0];
    const verifyOutput = jsonOutputs[1];

    expect(client.getRawIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(client.getIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(client.getRawTransaction).toHaveBeenCalledWith("tx", true);
    expect(client.updateIdentity).toHaveBeenCalledWith(payload);
    expect(payload).toMatchObject({
      name: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      contentmultimap: {
        "id:fum.vdns::vdns.record": [{ version: 1, type: "TXT", name: "keep", value: "stay", ttl: 300 }]
      }
    });
    expect(result.stdout).toContain("Target identity: chainvue.fum@");
    expect(result.stdout).toContain("Verifying target identity: chainvue.fum@");
    expect(verifyOutput.identity).toBe("chainvue.fum@");
    expect(verifyOutput.identity).not.toBe("chainvue@");
    expect(result.exitCode).toBeUndefined();
  });

  it("record set --verify waits for confirmation before verifying the target identity", async () => {
    const client = makeClient({ identity: "google@", contentmultimap: {} });
    client.getRawIdentity.mockResolvedValue({
      result: {
        identity: {
          name: "google",
          parent: "iParent",
          contentmultimap: {}
        }
      }
    });
    const result = await run([
      "record",
      "set",
      "google.fum@",
      "A",
      "@",
      "142.250.181.238",
      "--ttl",
      "300",
      "--root",
      "fum@",
      "--tld",
      "vdns",
      "--yes",
      "--verify",
      "--confirmations",
      "1"
    ], client);

    expect(client.getRawTransaction).toHaveBeenCalledWith("tx", true);
    expect(client.getIdentity).toHaveBeenCalledWith("google.fum@");
    expect(client.getIdentity).not.toHaveBeenCalledWith("google@");
    expect(client.getIdentity).not.toHaveBeenCalledWith("google");
    expect(result.stdout).toContain("Update transaction: tx");
    expect(result.stdout).toContain("Verifying target identity: google.fum@");
    expect(result.exitCode).toBeUndefined();
  });

  it("--no-wait-confirmation verifies immediately and warns about stale state", async () => {
    const client = makeClient({ identity: "google@", contentmultimap: {} });
    client.getRawIdentity.mockResolvedValue({
      result: {
        identity: {
          name: "google",
          parent: "iParent",
          contentmultimap: {}
        }
      }
    });
    const result = await run([
      "record",
      "set",
      "google.fum@",
      "A",
      "@",
      "142.250.181.238",
      "--root",
      "fum@",
      "--yes",
      "--verify",
      "--no-wait-confirmation"
    ], client);

    expect(client.getRawTransaction).not.toHaveBeenCalled();
    expect(client.getIdentity).toHaveBeenCalledWith("google.fum@");
    expect(result.stderr).toContain("verifying immediately without waiting for confirmation");
    expect(result.stderr).toContain("getidentity state may be stale");
    expect(result.exitCode).toBeUndefined();
  });

  it("fails clearly when --verify cannot extract an update transaction id", async () => {
    const client = makeClient({ identity: "google@", contentmultimap: {} });
    client.updateIdentity.mockResolvedValue({ result: { txid: "nested-not-supported" } });
    client.getRawIdentity.mockResolvedValue({
      result: {
        identity: {
          name: "google",
          parent: "iParent",
          contentmultimap: {}
        }
      }
    });
    const result = await run([
      "record",
      "set",
      "google.fum@",
      "A",
      "@",
      "142.250.181.238",
      "--root",
      "fum@",
      "--yes",
      "--verify"
    ], client);

    expect(client.getRawTransaction).not.toHaveBeenCalled();
    expect(client.getIdentity).not.toHaveBeenCalled();
    expect(result.stderr).toContain("Unable to extract updateidentity transaction id");
    expect(result.exitCode).toBe(1);
  });

  it("fetches the parent identity when subidentity raw data lacks parent", async () => {
    const client = makeClient({ identity: "chainvue@", contentmultimap: {} });
    client.getRawIdentity.mockImplementation(async (identity: string) => identity === "chainvue.fum@"
      ? { result: { identity: { name: "chainvue", contentmultimap: {} } } }
      : { result: { identity: { name: "fum", identityaddress: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe" } } });
    const result = await run([
      "record",
      "set",
      "chainvue.fum@",
      "TXT",
      "@",
      "hello",
      "--root",
      "fum@",
      "--yes"
    ], client);
    const payload = parseJsonOutputs(result.stdout)[0];

    expect(client.getRawIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(client.getRawIdentity).toHaveBeenCalledWith("fum@");
    expect(payload).toMatchObject({
      name: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe"
    });
    expect(result.exitCode).toBeUndefined();
  });

  it("fails closed when subidentity parent cannot be derived", async () => {
    const client = makeClient({ identity: "chainvue@", contentmultimap: {} });
    client.getRawIdentity.mockImplementation(async (identity: string) => identity === "chainvue.fum@"
      ? { result: { identity: { name: "chainvue", contentmultimap: {} } } }
      : { result: { identity: { name: "fum" } } });
    const result = await run([
      "record",
      "set",
      "chainvue.fum@",
      "TXT",
      "@",
      "hello",
      "--root",
      "fum@",
      "--yes"
    ], client);

    expect(client.updateIdentity).not.toHaveBeenCalled();
    expect(result.stderr).toContain("Cannot derive parent i-address for chainvue.fum@");
    expect(result.exitCode).toBe(1);
  });

  it("inspect chainvue.fum@ outputs the normalized target identity", async () => {
    const client = makeClient({
      identity: "chainvue@",
      contentmultimap: {
        "id:fum.vdns::vdns.record": [
          { version: 1, type: "REDIRECT", name: "@", url: "http://chainvue.io/", status: 302, ttl: 300 }
        ]
      }
    });
    const result = await run(["record", "inspect", "chainvue.fum@", "--root", "fum@", "--tld", "vdns"], client);
    const payload = JSON.parse(result.stdout);

    expect(client.getIdentity).toHaveBeenCalledWith("chainvue.fum@");
    expect(payload.identity).toBe("chainvue.fum@");
    expect(payload.identity).not.toBe("chainvue@");
    expect(result.exitCode).toBeUndefined();
  });

  it("inspect google.fum@ outputs the normalized target identity", async () => {
    const client = makeClient({
      identity: "google@",
      contentmultimap: {
        "id:fum.vdns::vdns.record": [
          { version: 1, type: "A", name: "@", value: "142.250.181.238", ttl: 300 }
        ]
      }
    });
    const result = await run(["record", "inspect", "google.fum@", "--root", "fum@", "--tld", "vdns"], client);
    const payload = JSON.parse(result.stdout);

    expect(client.getIdentity).toHaveBeenCalledWith("google.fum@");
    expect(payload.identity).toBe("google.fum@");
    expect(payload.identity).not.toBe("google@");
    expect(result.exitCode).toBeUndefined();
  });

  it("inspects decoded records from hex objectdata", async () => {
    const client = makeClient({
      identity: "dude@",
      contentmultimap: {
        "id:dude.vdns::vdns.record": [{
          i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv: {
            version: 1,
            label: "id:dude.vdns::vdns.web.redirect",
            mimetype: "application/json",
            objectdata: "7b2276657273696f6e223a312c2274797065223a225245444952454354222c226e616d65223a2240222c2275726c223a22687474703a2f2f636861696e7675652e696f2f222c22737461747573223a3330322c2274746c223a3330307d"
          }
        }]
      }
    });
    const result = await run(["record", "inspect", "dude@", "--root", "dude@"], client);
    const payload = JSON.parse(result.stdout);

    expect(payload.records).toEqual([{
      version: 1,
      type: "REDIRECT",
      name: "@",
      url: "http://chainvue.io/",
      status: 302,
      ttl: 300
    }]);
    expect(payload.warnings).toEqual([]);
  });
});
