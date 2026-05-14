import { LEGACY_VDNS_VDXF_KEYS, LEGACY_VNS_VDXF_KEYS, VDNS_VDXF_KEYS, VERUS_DATA_DESCRIPTOR_KEY } from "./constants.js";
import { decodeJsonObjectData, encodeJsonObjectData } from "./objectDataCodec.js";
import { validateRecord } from "./records.js";
import type { IdentityPayload, VdnsRecord } from "./types.js";
import type { VdnsVdxfIds } from "./vdxf.js";

export type DataDescriptor<T = unknown> = {
  version: 1;
  label: string;
  mimetype: "application/json";
  objectdata: T;
};

export type DataDescriptorWrapper<T = unknown> = {
  [VERUS_DATA_DESCRIPTOR_KEY]: DataDescriptor<T>;
};

export type ExtractedVdnsRecords = {
  records: VdnsRecord[];
  warnings: string[];
};

export type ExtractVdnsRecordsOptions = {
  symbolicFallback?: boolean;
};

export function extractContentmultimap(input: unknown): Record<string, unknown> {
  const identity = isRecord(input) && isRecord(input.result) && isRecord(input.result.identity)
    ? input.result.identity
    : isRecord(input) && isRecord(input.identity)
      ? input.identity
      : input;

  const contentmultimap = isRecord(identity) ? identity.contentmultimap : undefined;
  return isRecord(contentmultimap) ? { ...contentmultimap } : {};
}

export function buildDataDescriptorRecord(record: VdnsRecord, label: string): DataDescriptorWrapper<string> {
  return {
    [VERUS_DATA_DESCRIPTOR_KEY]: {
      version: 1,
      label,
      mimetype: "application/json",
      objectdata: encodeJsonObjectData(record)
    }
  };
}

export function extractVdnsRecords(
  identityPayload: IdentityPayload,
  vdnsRecordKey: string | string[],
  labelIds?: Partial<Record<VdnsRecord["type"], string>>,
  options: ExtractVdnsRecordsOptions = {}
): ExtractedVdnsRecords {
  const symbolicFallback = options.symbolicFallback ?? true;
  const recordKeys = Array.isArray(vdnsRecordKey) ? vdnsRecordKey : [vdnsRecordKey];
  const input = recordKeys.map((key) => identityPayload.contentmultimap?.[key]).find((entry) => entry !== undefined)
    ?? (symbolicFallback
      ? identityPayload.contentmultimap?.[VDNS_VDXF_KEYS.RECORD]
        ?? identityPayload.contentmultimap?.[LEGACY_VDNS_VDXF_KEYS.RECORD]
        ?? identityPayload.contentmultimap?.[LEGACY_VNS_VDXF_KEYS.RECORD]
      : undefined);
  if (input === undefined) {
    return { records: [], warnings: [`No vDNS records found for ${identityPayload.identity}`] };
  }

  if (!Array.isArray(input)) {
    return { records: [], warnings: [`vDNS record payload for ${identityPayload.identity} must be an array`] };
  }

  const records: VdnsRecord[] = [];
  const warnings: string[] = [];

  input.forEach((entry, index) => {
    const unwrapped = unwrapRecord(entry, labelIds);
    warnings.push(...unwrapped.warnings.map((warning) => `Skipping invalid vDNS record at index ${index}: ${warning}`));
    const candidate = unwrapped.record;
    if (!candidate) {
      return;
    }

    try {
      records.push(validateRecord(candidate));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown validation error";
      warnings.push(`Skipping invalid vDNS record at index ${index}: ${reason}`);
    }
  });

  return { records, warnings };
}

export function upsertVdnsRecord(
  contentmultimap: Record<string, unknown>,
  vdnsVdxfIds: VdnsVdxfIds,
  record: VdnsRecord
): Record<string, unknown> {
  const currentEntries = asArray(contentmultimap[vdnsVdxfIds.record]);
  const labelIds = vdnsVdxfIds.labels;
  const nextEntries = currentEntries.filter((entry) => !matchesRecord(entry, record.type, record.name, labelIds));
  nextEntries.push(buildDataDescriptorRecord(record, labelIds[record.type]));

  return {
    ...contentmultimap,
    [vdnsVdxfIds.record]: nextEntries
  };
}

export function removeVdnsRecord(
  contentmultimap: Record<string, unknown>,
  vdnsVdxfIds: VdnsVdxfIds,
  type: VdnsRecord["type"],
  name: string
): Record<string, unknown> {
  const currentEntries = asArray(contentmultimap[vdnsVdxfIds.record]);
  return {
    ...contentmultimap,
    [vdnsVdxfIds.record]: currentEntries.filter((entry) => !matchesRecord(entry, type, name, vdnsVdxfIds.labels))
  };
}

function matchesRecord(
  entry: unknown,
  type: VdnsRecord["type"],
  name: string,
  labelIds?: Partial<Record<VdnsRecord["type"], string>>
): boolean {
  const record = unwrapRecord(entry, labelIds).record;
  return Boolean(record && isRecord(record) && record.type === type && record.name === name);
}

function unwrapRecord(
  entry: unknown,
  labelIds?: Partial<Record<VdnsRecord["type"], string>>
): { record?: unknown; warnings: string[] } {
  if (!isRecord(entry)) {
    return { warnings: [] };
  }

  if (typeof entry.type === "string" && typeof entry.name === "string") {
    return { record: entry, warnings: [] };
  }

  const descriptor = entry[VERUS_DATA_DESCRIPTOR_KEY];
  if (!isRecord(descriptor)) {
    return { warnings: [] };
  }

  if (descriptor.mimetype !== "application/json") {
    return { warnings: [] };
  }

  const decoded = decodeJsonObjectData(descriptor.objectdata);
  const objectdata = decoded.value;
  if (!isRecord(objectdata)) {
    return { warnings: decoded.warnings };
  }

  const inferredType = inferRecordTypeFromLabel(descriptor.label, labelIds);
  if (!objectdata.type && inferredType) {
    objectdata.type = inferredType;
  }

  if (typeof objectdata.type !== "string") {
    return { warnings: decoded.warnings };
  }

  const expectedLabel = labelIds?.[objectdata.type as VdnsRecord["type"]];
  if (expectedLabel && !labelMatches(descriptor.label, expectedLabel)) {
    return { warnings: [] };
  }

  return { record: objectdata, warnings: decoded.warnings };
}

function inferRecordTypeFromLabel(
  label: unknown,
  labelIds?: Partial<Record<VdnsRecord["type"], string>>
): VdnsRecord["type"] | undefined {
  if (typeof label !== "string" || !labelIds) {
    return undefined;
  }

  return (Object.entries(labelIds) as Array<[VdnsRecord["type"], string | undefined]>)
    .find((entry) => entry[1] !== undefined && labelMatches(label, entry[1]))?.[0];
}

function labelMatches(label: unknown, expectedLabel: string): boolean {
  if (typeof label !== "string") {
    return false;
  }
  return label === expectedLabel
    || label === expectedLabel.replace("::vdns.", "::vns.")
    || label === expectedLabel.replace(".vdns::", ".vrsc::").replace("::vdns.", "::vns.");
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? [...input] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
