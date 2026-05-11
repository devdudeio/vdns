import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export type VdnsSiteManifestFile = {
  path: string;
  mime: string;
  size: number;
  sha256: string;
  uri: string;
};

export type VdnsSiteManifest = {
  version: 1;
  type: "VDNS_SITE_MANIFEST";
  entry: string;
  spaFallback: boolean;
  files: VdnsSiteManifestFile[];
};

export type BuildSiteManifestOptions = {
  entry?: string;
  spaFallback?: boolean;
  baseUri?: string;
  localFileUri?: boolean;
};

export type SiteManifestInspection = {
  entry: string;
  spaFallback: boolean;
  fileCount: number;
  totalSize: number;
  mimeSummary: Record<string, number>;
  warnings: string[];
};

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const sitePathSchema = z.string()
  .regex(/^\//, "must start with /")
  .refine((value) => !value.includes("\\"), "must not contain backslashes")
  .refine((value) => !value.split("/").includes(".."), "must not contain path traversal")
  .refine((value) => value !== "/", "must identify a file");
const uriSchema = z.string().url().refine((value) => {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return true;
    }
    return url.protocol === "file:" && (process.env.VDNS_SITE_ALLOW_FILE_URI ?? "false").toLowerCase() === "true";
  } catch {
    return false;
  }
}, "must use http:// or https://; file:// requires VDNS_SITE_ALLOW_FILE_URI=true");

export const vdnsSiteManifestSchema = z.object({
  version: z.literal(1),
  type: z.literal("VDNS_SITE_MANIFEST"),
  entry: sitePathSchema,
  spaFallback: z.boolean(),
  files: z.array(z.object({
    path: sitePathSchema,
    mime: z.string().min(1),
    size: z.number().int().min(0),
    sha256: sha256Schema,
    uri: uriSchema
  })).min(1)
}).superRefine((manifest, ctx) => {
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (seen.has(file.path)) {
      ctx.addIssue({ code: "custom", path: ["files"], message: `duplicate file path: ${file.path}` });
    }
    seen.add(file.path);
  }
  if (!seen.has(manifest.entry)) {
    ctx.addIssue({ code: "custom", path: ["entry"], message: "entry must reference a manifest file" });
  }
});

export function validateSiteManifest(input: unknown): VdnsSiteManifest {
  return vdnsSiteManifestSchema.parse(input);
}

export async function buildSiteManifest(dir: string, options: BuildSiteManifestOptions = {}): Promise<VdnsSiteManifest> {
  const root = path.resolve(dir);
  const entries = await listStaticFiles(root);
  const files: VdnsSiteManifestFile[] = [];
  for (const absolutePath of entries) {
    const relative = path.relative(root, absolutePath).split(path.sep).join("/");
    const manifestPath = `/${relative}`;
    const body = await readFile(absolutePath);
    files.push({
      path: manifestPath,
      mime: detectMimeType(absolutePath),
      size: body.byteLength,
      sha256: sha256Hex(body),
      uri: buildFileUri(root, absolutePath, manifestPath, options)
    });
  }

  return validateSiteManifest({
    version: 1,
    type: "VDNS_SITE_MANIFEST",
    entry: options.entry ?? "/index.html",
    spaFallback: options.spaFallback ?? false,
    files
  });
}

export async function writeSiteManifest(file: string, manifest: VdnsSiteManifest): Promise<void> {
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function loadSiteManifest(input: string, fetchImpl: typeof fetch = fetch): Promise<VdnsSiteManifest> {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    const response = await fetchImpl(input);
    if (!response.ok) {
      throw new Error(`Manifest fetch failed with HTTP ${response.status}`);
    }
    return validateSiteManifest(await response.json());
  }
  if (input.startsWith("file://")) {
    return validateSiteManifest(JSON.parse(await readFile(new URL(input), "utf8")));
  }
  return validateSiteManifest(JSON.parse(await readFile(input, "utf8")));
}

export function inspectSiteManifest(manifest: VdnsSiteManifest): SiteManifestInspection {
  const mimeSummary: Record<string, number> = {};
  let totalSize = 0;
  for (const file of manifest.files) {
    totalSize += file.size;
    mimeSummary[file.mime] = (mimeSummary[file.mime] ?? 0) + 1;
  }
  return {
    entry: manifest.entry,
    spaFallback: manifest.spaFallback,
    fileCount: manifest.files.length,
    totalSize,
    mimeSummary,
    warnings: manifest.spaFallback ? [] : ["spaFallback is disabled; unknown paths return 404"]
  };
}

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function detectMimeType(file: string): string {
  const ext = path.extname(file).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".htm": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".txt": "text/plain; charset=utf-8",
    ".wasm": "application/wasm",
    ".woff": "font/woff",
    ".woff2": "font/woff2"
  };
  return types[ext] ?? "application/octet-stream";
}

async function listStaticFiles(root: string): Promise<string[]> {
  const output: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === ".DS_Store" || entry.name === ".git" || entry.name === "node_modules") {
        continue;
      }
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
      } else if (entry.isFile()) {
        output.push(absolute);
      }
    }
  }
  await stat(root);
  await walk(root);
  return output.sort();
}

function buildFileUri(root: string, absolutePath: string, manifestPath: string, options: BuildSiteManifestOptions): string {
  if (options.localFileUri) {
    return pathToFileURL(absolutePath).toString();
  }
  if (!options.baseUri) {
    throw new Error("--base-uri is required unless --local-file-uri is used");
  }
  const base = new URL(options.baseUri.endsWith("/") ? options.baseUri : `${options.baseUri}/`);
  const relative = path.relative(root, absolutePath).split(path.sep).map(encodeURIComponent).join("/");
  const uri = new URL(relative, base);
  if (uri.protocol !== "http:" && uri.protocol !== "https:") {
    throw new Error("--base-uri must use http:// or https://");
  }
  if (manifestPath.includes("..")) {
    throw new Error("invalid static file path");
  }
  return uri.toString();
}
