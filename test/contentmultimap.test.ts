import { describe, expect, it } from "vitest";
import {
  buildDataDescriptorRecord,
  extractContentmultimap,
  extractVnsRecords,
  removeVnsRecord,
  upsertVnsRecord
} from "../src/core/contentmultimap.js";
import { VERUS_DATA_DESCRIPTOR_KEY, VNS_VDXF_KEYS } from "../src/core/constants.js";
import { encodeJsonObjectData } from "../src/core/objectDataCodec.js";
import type { VnsRecord } from "../src/core/types.js";
import type { VnsVdxfIds } from "../src/core/vdxf.js";

const vdxfIds: VnsVdxfIds = {
  record: "vdxf:vns.record",
  labels: {
    A: "vdxf:vns.dns.a",
    AAAA: "vdxf:vns.dns.aaaa",
    CNAME: "vdxf:vns.dns.cname",
    TXT: "vdxf:vns.dns.txt",
    REDIRECT: "vdxf:vns.web.redirect",
    TLSA: "vdxf:vns.tls.fingerprint"
  }
};

const aRecord: VnsRecord = { version: 1, type: "A", name: "@", value: "192.0.2.10", ttl: 300 };
const txtRecord: VnsRecord = { version: 1, type: "TXT", name: "www", value: "hello", ttl: 300 };

describe("contentmultimap helpers", () => {
  it("extracts contentmultimap from raw RPC and normalized identity payloads", () => {
    expect(extractContentmultimap({ result: { identity: { contentmultimap: { a: [1] } } } })).toEqual({ a: [1] });
    expect(extractContentmultimap({ identity: "dude@", contentmultimap: { b: [2] } })).toEqual({ b: [2] });
  });

  it("wraps records as Verus DataDescriptor JSON entries", () => {
    expect(buildDataDescriptorRecord(aRecord, vdxfIds.labels.A)).toEqual({
      [VERUS_DATA_DESCRIPTOR_KEY]: {
        version: 1,
        label: vdxfIds.labels.A,
        mimetype: "application/json",
        objectdata: encodeJsonObjectData(aRecord)
      }
    });
  });

  it("upserts DataDescriptor records while preserving unrelated contentmultimap keys", () => {
    const next = upsertVnsRecord({ unrelated: ["keep"] }, vdxfIds, aRecord);

    expect(next.unrelated).toEqual(["keep"]);
    expect(next[vdxfIds.record]).toEqual([buildDataDescriptorRecord(aRecord, vdxfIds.labels.A)]);
  });

  it("replaces existing entries with the same type and name", () => {
    const replacement: VnsRecord = { ...aRecord, value: "192.0.2.11" };
    const next = upsertVnsRecord({
      [vdxfIds.record]: [
        buildDataDescriptorRecord(aRecord, vdxfIds.labels.A),
        buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT)
      ]
    }, vdxfIds, replacement);

    expect(next[vdxfIds.record]).toEqual([
      buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT),
      buildDataDescriptorRecord(replacement, vdxfIds.labels.A)
    ]);
  });

  it("appends new records and preserves unrelated DataDescriptor entries", () => {
    const unrelatedDescriptor = {
      [VERUS_DATA_DESCRIPTOR_KEY]: {
        version: 1,
        label: "vdxf:unrelated",
        mimetype: "application/json",
        objectdata: { type: "A", name: "@", value: "not-vns" }
      }
    };
    const next = upsertVnsRecord({ [vdxfIds.record]: [unrelatedDescriptor] }, vdxfIds, txtRecord);

    expect(next[vdxfIds.record]).toEqual([
      unrelatedDescriptor,
      buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT)
    ]);
  });

  it("removes matching simplified or DataDescriptor wrapped records only", () => {
    const next = removeVnsRecord({
      [vdxfIds.record]: [
        aRecord,
        buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT),
        { random: true }
      ],
      unrelated: ["keep"]
    }, vdxfIds, "A", "@");

    expect(next).toEqual({
      [vdxfIds.record]: [
        buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT),
        { random: true }
      ],
      unrelated: ["keep"]
    });
  });

  it("extracts simplified and DataDescriptor wrapped records", () => {
    const result = extractVnsRecords({
      identity: "dude@",
      contentmultimap: {
        [vdxfIds.record]: [
          aRecord,
          buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT),
          buildDataDescriptorRecord({ ...aRecord, name: "api" }, vdxfIds.labels.TXT)
        ]
      }
    }, vdxfIds.record, vdxfIds.labels);

    expect(result.records).toEqual([aRecord, txtRecord]);
    expect(result.warnings).toEqual([]);
  });

  it("extracts DataDescriptor records with hex objectdata", () => {
    const hexWrappedRecord = buildDataDescriptorRecord(aRecord, vdxfIds.labels.A);
    const result = extractVnsRecords({
      identity: "dude@",
      contentmultimap: { [vdxfIds.record]: [hexWrappedRecord] }
    }, vdxfIds.record, vdxfIds.labels);

    expect(result.records).toEqual([aRecord]);
    expect(result.warnings).toEqual([]);
  });

  it("skips null objectdata with a warning", () => {
    const result = extractVnsRecords({
      identity: "dude@",
      contentmultimap: {
        [vdxfIds.record]: [{
          [VERUS_DATA_DESCRIPTOR_KEY]: {
            version: 1,
            label: vdxfIds.labels.A,
            mimetype: "application/json",
            objectdata: null
          }
        }]
      }
    }, vdxfIds.record, vdxfIds.labels);

    expect(result.records).toEqual([]);
    expect(result.warnings).toEqual([
      "Skipping invalid VNS record at index 0: DataDescriptor objectdata is null and cannot be decoded"
    ]);
  });

  it("classifies a DataDescriptor record type from the label VDXF ID", () => {
    const result = extractVnsRecords({
      identity: "dude@",
      contentmultimap: {
        [vdxfIds.record]: [{
          [VERUS_DATA_DESCRIPTOR_KEY]: {
            version: 1,
            label: vdxfIds.labels.A,
            mimetype: "application/json",
            objectdata: encodeJsonObjectData({ version: 1, name: "@", value: "192.0.2.10", ttl: 300 })
          }
        }]
      }
    }, vdxfIds.record, vdxfIds.labels);

    expect(result.records).toEqual([aRecord]);
    expect(result.warnings).toEqual([]);
  });

  it("replaces and removes matching records when existing entries are hex-encoded", () => {
    const replacement: VnsRecord = { ...aRecord, value: "192.0.2.11" };
    const next = upsertVnsRecord({
      [vdxfIds.record]: [
        buildDataDescriptorRecord(aRecord, vdxfIds.labels.A),
        buildDataDescriptorRecord(txtRecord, vdxfIds.labels.TXT)
      ]
    }, vdxfIds, replacement);

    expect(extractVnsRecords({ identity: "dude@", contentmultimap: next }, vdxfIds.record, vdxfIds.labels).records)
      .toEqual([txtRecord, replacement]);

    const removed = removeVnsRecord(next, vdxfIds, "TXT", "www");
    expect(extractVnsRecords({ identity: "dude@", contentmultimap: removed }, vdxfIds.record, vdxfIds.labels).records)
      .toEqual([replacement]);
  });

  it("falls back to the symbolic MVP record key", () => {
    const result = extractVnsRecords({
      identity: "dude@",
      contentmultimap: { [VNS_VDXF_KEYS.RECORD]: [txtRecord] }
    }, vdxfIds.record, vdxfIds.labels);

    expect(result.records).toEqual([txtRecord]);
  });
});
