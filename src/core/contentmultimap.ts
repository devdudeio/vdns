import { VERUS_DATA_DESCRIPTOR_KEY, VNS_VDXF_KEYS } from "./constants.js";
import { decodeJsonObjectData, encodeJsonObjectData } from "./objectDataCodec.js";
import { validateRecord } from "./records.js";
import type { IdentityPayload, VnsRecord } from "./types.js";
import type { VnsVdxfIds } from "./vdxf.js";

export type DataDescriptor<T = unknown> = {
  version: 1;
  label: string;
  mimetype: "application/json";
  objectdata: T;
};

export type DataDescriptorWrapper<T = unknown> = {
  [VERUS_DATA_DESCRIPTOR_KEY]: DataDescriptor<T>;
};

export type ExtractedVnsRecords = {
  records: VnsRecord[];
  warnings: string[];
};

export type ExtractVnsRecordsOptions = {
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

export function buildDataDescriptorRecord(record: VnsRecord, label: string): DataDescriptorWrapper<string> {
  return {
    [VERUS_DATA_DESCRIPTOR_KEY]: {
      version: 1,
      label,
      mimetype: "application/json",
      objectdata: encodeJsonObjectData(record)
    }
  };
}

export function extractVnsRecords(
  identityPayload: IdentityPayload,
  vnsRecordKey: string,
  labelIds?: Partial<Record<VnsRecord["type"], string>>,
  options: ExtractVnsRecordsOptions = {}
): ExtractedVnsRecords {
  const symbolicFallback = options.symbolicFallback ?? true;
  const input = identityPayload.contentmultimap?.[vnsRecordKey]
    ?? (symbolicFallback ? identityPayload.contentmultimap?.[VNS_VDXF_KEYS.RECORD] : undefined);
  if (input === undefined) {
    return { records: [], warnings: [`No VNS records found for ${identityPayload.identity}`] };
  }

  if (!Array.isArray(input)) {
    return { records: [], warnings: [`VNS record payload for ${identityPayload.identity} must be an array`] };
  }

  const records: VnsRecord[] = [];
  const warnings: string[] = [];

  input.forEach((entry, index) => {
    const unwrapped = unwrapRecord(entry, labelIds);
    warnings.push(...unwrapped.warnings.map((warning) => `Skipping invalid VNS record at index ${index}: ${warning}`));
    const candidate = unwrapped.record;
    if (!candidate) {
      return;
    }

    try {
      records.push(validateRecord(candidate));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown validation error";
      warnings.push(`Skipping invalid VNS record at index ${index}: ${reason}`);
    }
  });

  return { records, warnings };
}

export function upsertVnsRecord(
  contentmultimap: Record<string, unknown>,
  vnsVdxfIds: VnsVdxfIds,
  record: VnsRecord
): Record<string, unknown> {
  const currentEntries = asArray(contentmultimap[vnsVdxfIds.record]);
  const labelIds = vnsVdxfIds.labels;
  const nextEntries = currentEntries.filter((entry) => !matchesRecord(entry, record.type, record.name, labelIds));
  nextEntries.push(buildDataDescriptorRecord(record, labelIds[record.type]));

  return {
    ...contentmultimap,
    [vnsVdxfIds.record]: nextEntries
  };
}

export function removeVnsRecord(
  contentmultimap: Record<string, unknown>,
  vnsVdxfIds: VnsVdxfIds,
  type: VnsRecord["type"],
  name: string
): Record<string, unknown> {
  const currentEntries = asArray(contentmultimap[vnsVdxfIds.record]);
  return {
    ...contentmultimap,
    [vnsVdxfIds.record]: currentEntries.filter((entry) => !matchesRecord(entry, type, name, vnsVdxfIds.labels))
  };
}

function matchesRecord(
  entry: unknown,
  type: VnsRecord["type"],
  name: string,
  labelIds?: Partial<Record<VnsRecord["type"], string>>
): boolean {
  const record = unwrapRecord(entry, labelIds).record;
  return Boolean(record && isRecord(record) && record.type === type && record.name === name);
}

function unwrapRecord(
  entry: unknown,
  labelIds?: Partial<Record<VnsRecord["type"], string>>
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

  const expectedLabel = labelIds?.[objectdata.type as VnsRecord["type"]];
  if (expectedLabel && descriptor.label !== expectedLabel) {
    return { warnings: [] };
  }

  return { record: objectdata, warnings: decoded.warnings };
}

function inferRecordTypeFromLabel(
  label: unknown,
  labelIds?: Partial<Record<VnsRecord["type"], string>>
): VnsRecord["type"] | undefined {
  if (typeof label !== "string" || !labelIds) {
    return undefined;
  }

  return (Object.entries(labelIds) as Array<[VnsRecord["type"], string | undefined]>)
    .find((entry) => entry[1] === label)?.[0];
}

function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? [...input] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
