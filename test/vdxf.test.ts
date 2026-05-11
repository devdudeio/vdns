import { describe, expect, it, vi } from "vitest";
import { buildVnsVdxfKeyNames, resolveVnsVdxfIds } from "../src/core/vdxf.js";

describe("VNS VDXF helpers", () => {
  it.each([
    ["dude@", "vrsc", "dude.vrsc::vns.record"],
    ["VERUSNAMESERVICE@", "vrsc", "verusnameservice.vrsc::vns.record"],
    ["myname.vns@", "vrsc", "myname.vns.vrsc::vns.record"]
  ])("builds lowercase key names for root %s", (root, tld, expectedRecordKey) => {
    const keys = buildVnsVdxfKeyNames(root, tld);

    expect(keys.record).toBe(expectedRecordKey);
    expect(keys.labels).toEqual({
      A: expectedRecordKey.replace("vns.record", "vns.dns.a"),
      AAAA: expectedRecordKey.replace("vns.record", "vns.dns.aaaa"),
      CNAME: expectedRecordKey.replace("vns.record", "vns.dns.cname"),
      TXT: expectedRecordKey.replace("vns.record", "vns.dns.txt"),
      REDIRECT: expectedRecordKey.replace("vns.record", "vns.web.redirect"),
      PROXY: expectedRecordKey.replace("vns.record", "vns.web.proxy"),
      SITE: expectedRecordKey.replace("vns.record", "vns.web.site"),
      TLSA: expectedRecordKey.replace("vns.record", "vns.tls.fingerprint")
    });
  });

  it("resolves all symbolic VDXF keys through getvdxfid", async () => {
    const getVdxfId = vi.fn(async (key: string) => `id:${key}`);
    const keyNames = buildVnsVdxfKeyNames("dude@", "vrsc");

    await expect(resolveVnsVdxfIds({ getVdxfId }, keyNames)).resolves.toEqual({
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
