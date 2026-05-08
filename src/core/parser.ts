import { VNS_VDXF_KEYS } from "./constants.js";
import { extractVnsRecords } from "./contentmultimap.js";
import type { IdentityPayload, VnsRecord } from "./types.js";
import type { VnsVdxfIds } from "./vdxf.js";

export type ParsedIdentityRecords = {
  records: VnsRecord[];
  warnings: string[];
};

export type ParseIdentityRecordsOptions = {
  vnsVdxfIds?: VnsVdxfIds;
  symbolicFallback?: boolean;
};

export function parseIdentityRecords(
  identityPayload: IdentityPayload,
  options: ParseIdentityRecordsOptions = {}
): ParsedIdentityRecords {
  return extractVnsRecords(
    identityPayload,
    options.vnsVdxfIds?.record ?? VNS_VDXF_KEYS.RECORD,
    options.vnsVdxfIds?.labels,
    { symbolicFallback: options.symbolicFallback ?? true }
  );
}
