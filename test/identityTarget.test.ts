import { describe, expect, it } from "vitest";
import {
  deriveParentLookupIdentity,
  deriveUpdateIdentityTarget,
  extractRawIdentityAddress,
  normalizeIdentityNameForUpdate
} from "../src/core/identityTarget.js";

const chainvueRaw = {
  result: {
    identity: {
      name: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      identityaddress: "i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS",
      contentmultimap: {}
    }
  }
};

describe("identity target helpers", () => {
  it.each([
    ["chainvue.vdns@", "chainvue.vdns@"],
    ["chainvue.vdns", "chainvue.vdns@"],
    [" google.vdns@ ", "google.vdns@"],
    ["chainvue@", "chainvue@"]
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeIdentityNameForUpdate(input)).toBe(expected);
  });

  it.each(["", "foo/bar@", "foo bar@"])("rejects invalid identity %j", (input) => {
    expect(() => normalizeIdentityNameForUpdate(input)).toThrow();
  });

  it("derives the update target for the real chainvue.vdns raw response shape", () => {
    expect(deriveUpdateIdentityTarget("chainvue.vdns@", chainvueRaw)).toMatchObject({
      targetIdentity: "chainvue.vdns@",
      updateIdentityName: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      identityAddress: "i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS"
    });
  });

  it("falls back to local-name extraction for root and subidentities", () => {
    expect(deriveUpdateIdentityTarget("chainvue.vdns@", { result: { identity: {} } }).updateIdentityName).toBe("chainvue");
    expect(deriveUpdateIdentityTarget("chainvue@", { result: { identity: {} } }).updateIdentityName).toBe("chainvue@");
  });

  it("derives parent lookup identities from namespace suffixes", () => {
    expect(deriveParentLookupIdentity("chainvue.vdns@")).toBe("vdns@");
    expect(deriveParentLookupIdentity("a.b.vdns@")).toBe("b.vdns@");
    expect(deriveParentLookupIdentity("vdns@")).toBeUndefined();
  });

  it("extracts raw identity addresses from RPC response wrappers", () => {
    expect(extractRawIdentityAddress(chainvueRaw)).toBe("i7Mki7dLpVxdanKubmZJksuJBLtUqY4MyS");
  });
});
