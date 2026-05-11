import { describe, expect, it } from "vitest";
import validFixture from "../fixtures/identities/myname.VNS.json" with { type: "json" };
import invalidFixture from "../fixtures/identities/invalid-records.VNS.json" with { type: "json" };
import { VERUS_DATA_DESCRIPTOR_KEY } from "../src/core/constants.js";
import { encodeJsonObjectData } from "../src/core/objectDataCodec.js";
import { parseIdentityRecords } from "../src/core/parser.js";
import type { VnsVdxfIds } from "../src/core/vdxf.js";

const vdxfIds: VnsVdxfIds = {
  record: "iFLfRN1bcVckxotkYPuWHVuoihfafbS8F5",
  labels: {
    A: "iPYBHLkzfMAnzkdQUSrqh4i7rCCW9tJpvE",
    AAAA: "id:aaaa",
    CNAME: "id:cname",
    TXT: "id:txt",
    REDIRECT: "id:redirect",
    PROXY: "id:proxy",
    SITE: "id:site",
    TLSA: "id:tlsa"
  }
};

describe("parseIdentityRecords", () => {
  it("parses valid fixture records", () => {
    const result = parseIdentityRecords(validFixture);
    expect(result.warnings).toEqual([]);
    expect(result.records).toHaveLength(6);
  });

  it("skips invalid records and collects warnings", () => {
    const result = parseIdentityRecords(invalidFixture);
    expect(result.records).toEqual([{ version: 1, type: "TXT", name: "@", value: "valid=record", ttl: 300 }]);
    expect(result.warnings).toHaveLength(2);
  });

  it("warns when record key is missing", () => {
    const result = parseIdentityRecords({ identity: "empty.VNS@", contentmultimap: {} });
    expect(result.records).toEqual([]);
    expect(result.warnings[0]).toContain("No VNS records");
  });

  it("parses real Verus DataDescriptor hex objectdata when VDXF IDs are provided", () => {
    const result = parseIdentityRecords({
      identity: "google.fum@",
      contentmultimap: {
        [vdxfIds.record]: [{
          [VERUS_DATA_DESCRIPTOR_KEY]: {
            version: 1,
            label: vdxfIds.labels.A,
            mimetype: "application/json",
            objectdata: encodeJsonObjectData({
              version: 1,
              name: "@",
              ttl: 300,
              type: "A",
              value: "142.250.181.238"
            })
          }
        }]
      }
    }, { vnsVdxfIds: vdxfIds, symbolicFallback: false });

    expect(result).toEqual({
      records: [{ version: 1, type: "A", name: "@", value: "142.250.181.238", ttl: 300 }],
      warnings: []
    });
  });

  it("parses PROXY records from DataDescriptor hex objectdata", () => {
    const result = parseIdentityRecords({
      identity: "verus.fum@",
      contentmultimap: {
        [vdxfIds.record]: [{
          [VERUS_DATA_DESCRIPTOR_KEY]: {
            version: 1,
            label: vdxfIds.labels.PROXY,
            mimetype: "application/json",
            objectdata: encodeJsonObjectData({
              version: 1,
              name: "@",
              ttl: 300,
              type: "PROXY",
              url: "https://verus.io/"
            })
          }
        }]
      }
    }, { vnsVdxfIds: vdxfIds, symbolicFallback: false });

    expect(result.records).toEqual([{ version: 1, type: "PROXY", name: "@", url: "https://verus.io/", ttl: 300 }]);
    expect(result.warnings).toEqual([]);
  });
});
