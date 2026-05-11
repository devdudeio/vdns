import { describe, expect, it, vi } from "vitest";
import { buildVdnsVdxfKeyNames, resolveVdnsVdxfIds } from "../src/core/vdxf.js";

describe("vDNS VDXF helpers", () => {
  it.each([
    ["dude@", "vdns", "dude.vdns::vdns.record"],
    ["VERUSNAMESERVICE@", "vdns", "verusnameservice.vdns::vdns.record"],
    ["myname.vdns@", "vdns", "myname.vdns.vdns::vdns.record"]
  ])("builds lowercase key names for root %s", (root, tld, expectedRecordKey) => {
    const keys = buildVdnsVdxfKeyNames(root, tld);

    expect(keys.record).toBe(expectedRecordKey);
    expect(keys.labels).toEqual({
      A: expectedRecordKey.replace("vdns.record", "vdns.dns.a"),
      AAAA: expectedRecordKey.replace("vdns.record", "vdns.dns.aaaa"),
      CNAME: expectedRecordKey.replace("vdns.record", "vdns.dns.cname"),
      TXT: expectedRecordKey.replace("vdns.record", "vdns.dns.txt"),
      REDIRECT: expectedRecordKey.replace("vdns.record", "vdns.web.redirect"),
      PROXY: expectedRecordKey.replace("vdns.record", "vdns.web.proxy"),
      SITE: expectedRecordKey.replace("vdns.record", "vdns.web.site"),
      TLSA: expectedRecordKey.replace("vdns.record", "vdns.tls.fingerprint")
    });
  });

  it("resolves all symbolic VDXF keys through getvdxfid", async () => {
    const getVdxfId = vi.fn(async (key: string) => `id:${key}`);
    const keyNames = buildVdnsVdxfKeyNames("dude@", "vdns");

    await expect(resolveVdnsVdxfIds({ getVdxfId }, keyNames)).resolves.toEqual({
      record: `id:${keyNames.record}`,
      labels: {
        A: `id:${keyNames.labels.A}`,
        AAAA: `id:${keyNames.labels.AAAA}`,
        CNAME: `id:${keyNames.labels.CNAME}`,
        TXT: `id:${keyNames.labels.TXT}`,
        REDIRECT: `id:${keyNames.labels.REDIRECT}`,
        PROXY: `id:${keyNames.labels.PROXY}`,
        SITE: `id:${keyNames.labels.SITE}`,
        TLSA: `id:${keyNames.labels.TLSA}`
      }
    });
    expect(getVdxfId).toHaveBeenCalledTimes(9);
  });
});
