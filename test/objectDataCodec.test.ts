import { describe, expect, it } from "vitest";
import { decodeJsonObjectData, encodeJsonObjectData } from "../src/core/objectDataCodec.js";

const redirectRecord = {
  version: 1,
  type: "REDIRECT",
  name: "@",
  url: "http://chainvue.io/",
  status: 302,
  ttl: 300
};

const redirectHex = "7b2276657273696f6e223a312c2274797065223a225245444952454354222c226e616d65223a2240222c2275726c223a22687474703a2f2f636861696e7675652e696f2f222c22737461747573223a3330322c2274746c223a3330307d";

describe("objectdata codec", () => {
  it("encodes JSON as lowercase UTF-8 hex", () => {
    const encoded = encodeJsonObjectData({ hello: "vDNS" });

    expect(encoded).toBe("7b2268656c6c6f223a2276444e53227d");
    expect(encoded).toBe(encoded.toLowerCase());
  });

  it("round-trips encoded JSON", () => {
    const value = { version: 1, type: "TXT", name: "@", value: "hello", ttl: 300 };

    expect(decodeJsonObjectData(encodeJsonObjectData(value))).toEqual({ value, warnings: [] });
  });

  it("decodes a real-style REDIRECT hex objectdata string", () => {
    expect(decodeJsonObjectData(redirectHex)).toEqual({ value: redirectRecord, warnings: [] });
  });

  it("keeps raw objectdata objects for fixture compatibility", () => {
    expect(decodeJsonObjectData(redirectRecord)).toEqual({ value: redirectRecord, warnings: [] });
  });

  it("warns for null, invalid hex, and invalid JSON hex", () => {
    expect(decodeJsonObjectData(null).warnings).toEqual(["DataDescriptor objectdata is null and cannot be decoded"]);
    expect(decodeJsonObjectData("not-hex").warnings).toEqual(["DataDescriptor objectdata is not valid hex"]);
    expect(decodeJsonObjectData("7b").warnings).toEqual(["DataDescriptor objectdata hex did not decode to valid JSON"]);
  });
});
