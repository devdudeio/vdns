import type { VdnsRecordType } from "./types.js";

export type VdnsVdxfKeyNames = {
  record: string;
  labels: Record<VdnsRecordType, string>;
};

export type VdnsVdxfIds = {
  record: string;
  labels: Record<VdnsRecordType, string>;
};

export const VDNS_RECORD_TYPE_LABELS: Record<VdnsRecordType, string> = {
  A: "vdns.dns.a",
  AAAA: "vdns.dns.aaaa",
  CNAME: "vdns.dns.cname",
  TXT: "vdns.dns.txt",
  REDIRECT: "vdns.web.redirect",
  PROXY: "vdns.web.proxy",
  SITE: "vdns.web.site",
  TLSA: "vdns.tls.fingerprint"
};

type VdxfRpcLike = {
  getVdxfId(key: string): Promise<string>;
};

export function buildVdnsVdxfKeyNames(rootIdentity: string, tld: string): VdnsVdxfKeyNames {
  const namespace = `${rootIdentity.replace(/@$/, "")}.${tld}`.toLowerCase();
  return {
    record: `${namespace}::vdns.record`,
    labels: {
      A: `${namespace}::${VDNS_RECORD_TYPE_LABELS.A}`,
      AAAA: `${namespace}::${VDNS_RECORD_TYPE_LABELS.AAAA}`,
      CNAME: `${namespace}::${VDNS_RECORD_TYPE_LABELS.CNAME}`,
      TXT: `${namespace}::${VDNS_RECORD_TYPE_LABELS.TXT}`,
      REDIRECT: `${namespace}::${VDNS_RECORD_TYPE_LABELS.REDIRECT}`,
      PROXY: `${namespace}::${VDNS_RECORD_TYPE_LABELS.PROXY}`,
      SITE: `${namespace}::${VDNS_RECORD_TYPE_LABELS.SITE}`,
      TLSA: `${namespace}::${VDNS_RECORD_TYPE_LABELS.TLSA}`
    }
  };
}

export async function resolveVdnsVdxfIds(rpcClient: VdxfRpcLike, keyNames: VdnsVdxfKeyNames): Promise<VdnsVdxfIds> {
  const [record, a, aaaa, cname, txt, redirect, proxy, site, tlsa] = await Promise.all([
    rpcClient.getVdxfId(keyNames.record),
    rpcClient.getVdxfId(keyNames.labels.A),
    rpcClient.getVdxfId(keyNames.labels.AAAA),
    rpcClient.getVdxfId(keyNames.labels.CNAME),
    rpcClient.getVdxfId(keyNames.labels.TXT),
    rpcClient.getVdxfId(keyNames.labels.REDIRECT),
    rpcClient.getVdxfId(keyNames.labels.PROXY),
    rpcClient.getVdxfId(keyNames.labels.SITE),
    rpcClient.getVdxfId(keyNames.labels.TLSA)
  ]);

  return {
    record,
    labels: {
      A: a,
      AAAA: aaaa,
      CNAME: cname,
      TXT: txt,
      REDIRECT: redirect,
      PROXY: proxy,
      SITE: site,
      TLSA: tlsa
    }
  };
}
