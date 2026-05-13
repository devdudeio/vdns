import { describe, expect, it } from "vitest";
import type { VdnsConfig } from "../src/config.js";
import { parseVdnsDomain } from "../src/core/domain.js";

const config = (rootIdentity: string): VdnsConfig => ({
  rootIdentity,
  tld: "vdns",
  defaultTtl: 300,
  mode: "mock",
  port: 8080,
  verusRpcTimeoutMs: 10000
});

describe("parseVdnsDomain", () => {
  it("maps default vdns root domains", () => {
    expect(parseVdnsDomain("myname.vdns", config("vdns@"))).toEqual({
      domain: "myname.vdns",
      identity: "myname.vdns@",
      host: "@"
    });
    expect(parseVdnsDomain("www.myname.vdns", config("vdns@"))).toEqual({
      domain: "www.myname.vdns",
      identity: "myname.vdns@",
      host: "www"
    });
  });

  it("maps VERUSNAMESERVICE root domains", () => {
    expect(parseVdnsDomain("api.myname.vdns", config("VERUSNAMESERVICE@"))).toEqual({
      domain: "api.myname.vdns",
      identity: "myname.VERUSNAMESERVICE@",
      host: "api"
    });
  });

  it("maps nested root identity domains", () => {
    expect(parseVdnsDomain("www.alice.vdns", config("myname.vdns@"))).toEqual({
      domain: "www.alice.vdns",
      identity: "alice.myname.vdns@",
      host: "www"
    });
  });

  it("normalizes case and trailing dot", () => {
    expect(parseVdnsDomain("WWW.MYNAME.VDNS.", config("vdns@"))).toEqual({
      domain: "www.myname.vdns",
      identity: "myname.vdns@",
      host: "www"
    });
  });

  it.each(["a.b.myname.vdns", "myname.com", "vdns", ".vdns", "myname.vdns.example.com", "bad_name.vdns"])(
    "rejects invalid domain %s",
    (domain) => {
      expect(() => parseVdnsDomain(domain, config("vdns@"))).toThrow();
    }
  );
});
