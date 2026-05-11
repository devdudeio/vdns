import { isIP } from "node:net";
import { z } from "zod";
import { SUPPORTED_RECORD_TYPES } from "./constants.js";
import type { VnsRecord, VnsRecordType } from "./types.js";

const recordNameSchema = z.string().regex(/^(?:@|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/);
const ttlSchema = z.number().int().min(30).max(86400);
const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .refine((value) => {
    const hostname = value.endsWith(".") ? value.slice(0, -1) : value;
    const labels = hostname.split(".");
    return labels.every((label) => /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(label));
  }, "must be a valid hostname");

const baseRecordSchema = z.object({
  version: z.literal(1),
  name: recordNameSchema,
  ttl: ttlSchema
});

const aRecordSchema = baseRecordSchema.extend({
  type: z.literal("A"),
  value: z.string().refine((value) => isIP(value) === 4, "must be a valid IPv4 address")
});

const aaaaRecordSchema = baseRecordSchema.extend({
  type: z.literal("AAAA"),
  value: z.string().refine((value) => isIP(value) === 6, "must be a valid IPv6 address")
});

const cnameRecordSchema = baseRecordSchema.extend({
  type: z.literal("CNAME"),
  value: hostnameSchema
});

const txtRecordSchema = baseRecordSchema.extend({
  type: z.literal("TXT"),
  value: z.string().min(1)
});

const redirectRecordSchema = baseRecordSchema.extend({
  type: z.literal("REDIRECT"),
  url: z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "must use http:// or https://"
  }),
  status: z.union([z.literal(301), z.literal(302)])
});

const proxyRecordSchema = baseRecordSchema.extend({
  type: z.literal("PROXY"),
  url: z.string().url().refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
    message: "must use http:// or https://"
  })
});

const siteRecordSchema = baseRecordSchema.extend({
  type: z.literal("SITE"),
  entry: z.string().regex(/^\/(?:[^\\]*[^/])?$/, "must start with / and must not contain backslashes").default("/index.html"),
  manifestUri: z.string().url().refine((value) => {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return true;
    }
    return value.startsWith("file://") && (process.env.VDNS_SITE_ALLOW_FILE_URI ?? "false").toLowerCase() === "true";
  }, {
    message: "must use http:// or https://; file:// requires VDNS_SITE_ALLOW_FILE_URI=true"
  }),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

const tlsaRecordSchema = baseRecordSchema.extend({
  type: z.literal("TLSA"),
  sha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export const vnsRecordSchema = z.discriminatedUnion("type", [
  aRecordSchema,
  aaaaRecordSchema,
  cnameRecordSchema,
  txtRecordSchema,
  redirectRecordSchema,
  proxyRecordSchema,
  siteRecordSchema,
  tlsaRecordSchema
]);

export const recordTypeSchema = z.enum(SUPPORTED_RECORD_TYPES);

export function validateRecord(input: unknown): VnsRecord {
  return vnsRecordSchema.parse(input);
}

export function isRecordType(input: string): input is VnsRecordType {
  return recordTypeSchema.safeParse(input).success;
}

export function filterRecordsForHostAndType(
  records: VnsRecord[],
  host: string,
  type?: VnsRecordType
): VnsRecord[] {
  return records.filter((record) => record.name === host && (!type || record.type === type));
}
