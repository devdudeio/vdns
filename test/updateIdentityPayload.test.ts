import { describe, expect, it } from "vitest";
import { buildUpdateIdentityPayload } from "../src/core/updateIdentityPayload.js";

describe("buildUpdateIdentityPayload", () => {
  it("returns the exact MVP updateidentity payload shape", () => {
    expect(buildUpdateIdentityPayload({ updateIdentityName: "dude@", contentmultimap: { key: ["value"] } })).toEqual({
      name: "dude@",
      contentmultimap: { key: ["value"] }
    });
  });

  it("includes parent when provided", () => {
    expect(buildUpdateIdentityPayload({
      updateIdentityName: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      contentmultimap: {}
    })).toEqual({
      name: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      contentmultimap: {}
    });
  });

  it("omits parent when absent", () => {
    expect(buildUpdateIdentityPayload({ updateIdentityName: "chainvue@", contentmultimap: {} })).toEqual({
      name: "chainvue@",
      contentmultimap: {}
    });
  });

  it("does not use the full subidentity target as the payload name", () => {
    expect(buildUpdateIdentityPayload({
      updateIdentityName: "chainvue",
      parent: "i4KtZ8jeMipNJfAdmfxkzQZKmaGpjvhYKe",
      contentmultimap: {}
    }).name).not.toBe("chainvue.vdns@");
  });
});
