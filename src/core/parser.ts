import { LEGACY_VNS_VDXF_KEYS, VDNS_VDXF_KEYS } from "./constants.js";
import { extractVdnsRecords } from "./contentmultimap.js";
import type { IdentityPayload, VdnsRecord } from "./types.js";
import type { VdnsVdxfIds } from "./vdxf.js";

export type ParsedIdentityRecords = {
  records: VdnsRecord[];
  warnings: string[];
};

export type ParseIdentityRecordsOptions = {
  vdnsVdxfIds?: VdnsVdxfIds;
  symbolicFallback?: boolean;
};

export function parseIdentityRecords(
  identityPayload: IdentityPayload,
  options: ParseIdentityRecordsOptions = {}
): ParsedIdentityRecords {
  return extractVdnsRecords(
    identityPayload,
    [options.vdnsVdxfIds?.record ?? VDNS_VDXF_KEYS.RECORD, LEGACY_VNS_VDXF_KEYS.RECORD],
    options.vdnsVdxfIds?.labels,
    { symbolicFallback: options.symbolicFallback ?? true }
  );
}
