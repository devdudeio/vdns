import { describe, expect, it } from "vitest";
import { filterRecordsForHostAndType, validateRecord } from "../src/core/records.js";
import type { VnsRecord } from "../src/core/types.js";

describe("records", () => {
  it.each([
    [{ version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 300 }],
    [{ version: 1, type: "AAAA", name: "@", value: "2001:db8::1", ttl: 300 }],
    [{ version: 1, type: "CNAME", name: "www", value: "example.pages.dev", ttl: 300 }],
    [{ version: 1, type: "TXT", name: "@", value: "vns=verus", ttl: 300 }],
    [{ version: 1, type: "REDIRECT", name: "@", url: "https://example.com", status: 302, ttl: 300 }],
    [{ version: 1, type: "PROXY", name: "@", url: "https://example.com", ttl: 300 }],
    [{ version: 1, type: "TLSA", name: "@", sha256: "a".repeat(64), ttl: 300 }]
  ])("validates valid record %#", (record) => {
    expect(validateRecord(record)).toEqual(record);
  });

  it.each([
    [{ version: 2, type: "A", name: "@", value: "203.0.113.42", ttl: 300 }],
    [{ version: 1, type: "A", name: "@", value: "bad", ttl: 300 }],
    [{ version: 1, type: "AAAA", name: "@", value: "203.0.113.42", ttl: 300 }],
    [{ version: 1, type: "CNAME", name: "www", value: "-bad.example", ttl: 300 }],
    [{ version: 1, type: "TXT", name: "@", value: "", ttl: 300 }],
    [{ version: 1, type: "REDIRECT", name: "@", url: "ftp://example.com", status: 302, ttl: 300 }],
    [{ version: 1, type: "REDIRECT", name: "@", url: "https://example.com", status: 307, ttl: 300 }],
    [{ version: 1, type: "PROXY", name: "@", url: "ftp://example.com", ttl: 300 }],
    [{ version: 1, type: "TLSA", name: "@", sha256: "A".repeat(64), ttl: 300 }],
    [{ version: 1, type: "A", name: "bad.name", value: "203.0.113.42", ttl: 300 }],
    [{ version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 29 }]
  ])("rejects invalid record %#", (record) => {
    expect(() => validateRecord(record)).toThrow();
  });

  it("filters by host and optional type", () => {
    const records: VnsRecord[] = [
      { version: 1, type: "A", name: "@", value: "203.0.113.42", ttl: 300 },
      { version: 1, type: "TXT", name: "@", value: "vns=verus", ttl: 300 },
      { version: 1, type: "CNAME", name: "www", value: "example.pages.dev", ttl: 300 }
    ];

    expect(filterRecordsForHostAndType(records, "@")).toHaveLength(2);
    expect(filterRecordsForHostAndType(records, "@", "A")).toEqual([records[0]]);
    expect(filterRecordsForHostAndType(records, "www", "CNAME")).toEqual([records[2]]);
  });
});
