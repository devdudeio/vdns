import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/core/cache.js";

describe("TtlCache", () => {
  it("gets, expires, and deletes entries", () => {
    let now = 1_000;
    const cache = new TtlCache<string>(() => now);

    cache.set("key", "value", 1);
    expect(cache.get("key")).toBe("value");

    now = 2_001;
    expect(cache.get("key")).toBeUndefined();

    cache.set("key", "value", 10);
    cache.delete("key");
    expect(cache.get("key")).toBeUndefined();
  });
});
