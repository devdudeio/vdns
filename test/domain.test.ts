import { describe, expect, it } from "vitest";
import type { VnsConfig } from "../src/config.js";
import { parseVnsDomain } from "../src/core/domain.js";

const config = (rootIdentity: string): VnsConfig => ({
  rootIdentity,
  tld: "vrsc",
  defaultTtl: 300,
  mode: "mock",
  port: 8080,
  verusRpcTimeoutMs: 10000
});

describe("parseVnsDomain", () => {
  it("maps default fum root domains", () => {
    expect(parseVnsDomain("myname.vrsc", config("fum@"))).toEqual({
      domain: "myname.vrsc",
      identity: "myname.fum@",
      host: "@"
    });
    expect(parseVnsDomain("www.myname.vrsc", config("fum@"))).toEqual({
      domain: "www.myname.vrsc",
      identity: "myname.fum@",
      host: "www"
    });
  });

  it("maps VERUSNAMESERVICE root domains", () => {
    expect(parseVnsDomain("api.myname.vrsc", config("VERUSNAMESERVICE@"))).toEqual({
      domain: "api.myname.vrsc",
      identity: "myname.VERUSNAMESERVICE@",
      host: "api"
    });
  });

  it("maps nested root identity domains", () => {
    expect(parseVnsDomain("www.alice.vrsc", config("myname.vns@"))).toEqual({
      domain: "www.alice.vrsc",
      identity: "alice.myname.vns@",
      host: "www"
    });
  });

  it("normalizes case and trailing dot", () => {
    expect(parseVnsDomain("WWW.MYNAME.VRSC.", config("fum@"))).toEqual({
      domain: "www.myname.vrsc",
      identity: "myname.fum@",
      host: "www"
    });
  });

  it.each(["a.b.myname.vrsc", "myname.com", "vrsc", ".vrsc", "myname.vrsc.example.com", "bad_name.vrsc"])(
    "rejects invalid domain %s",
    (domain) => {
      expect(() => parseVnsDomain(domain, config("fum@"))).toThrow();
    }
  );
});
