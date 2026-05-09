import type { VnsRecordType } from "./types.js";

export type VnsVdxfKeyNames = {
  record: string;
  labels: Record<VnsRecordType, string>;
};

export type VnsVdxfIds = {
  record: string;
  labels: Record<VnsRecordType, string>;
};

export const VNS_RECORD_TYPE_LABELS: Record<VnsRecordType, string> = {
  A: "vns.dns.a",
  AAAA: "vns.dns.aaaa",
  CNAME: "vns.dns.cname",
  TXT: "vns.dns.txt",
  REDIRECT: "vns.web.redirect",
  PROXY: "vns.web.proxy",
  TLSA: "vns.tls.fingerprint"
};

type VdxfRpcLike = {
  getVdxfId(key: string): Promise<string>;
};

export function buildVnsVdxfKeyNames(rootIdentity: string, tld: string): VnsVdxfKeyNames {
  const namespace = `${rootIdentity.replace(/@$/, "")}.${tld}`.toLowerCase();
  return {
    record: `${namespace}::vns.record`,
    labels: {
      A: `${namespace}::${VNS_RECORD_TYPE_LABELS.A}`,
      AAAA: `${namespace}::${VNS_RECORD_TYPE_LABELS.AAAA}`,
      CNAME: `${namespace}::${VNS_RECORD_TYPE_LABELS.CNAME}`,
      TXT: `${namespace}::${VNS_RECORD_TYPE_LABELS.TXT}`,
      REDIRECT: `${namespace}::${VNS_RECORD_TYPE_LABELS.REDIRECT}`,
      PROXY: `${namespace}::${VNS_RECORD_TYPE_LABELS.PROXY}`,
      TLSA: `${namespace}::${VNS_RECORD_TYPE_LABELS.TLSA}`
    }
  };
}

export async function resolveVnsVdxfIds(rpcClient: VdxfRpcLike, keyNames: VnsVdxfKeyNames): Promise<VnsVdxfIds> {
  const [record, a, aaaa, cname, txt, redirect, proxy, tlsa] = await Promise.all([
    rpcClient.getVdxfId(keyNames.record),
    rpcClient.getVdxfId(keyNames.labels.A),
    rpcClient.getVdxfId(keyNames.labels.AAAA),
    rpcClient.getVdxfId(keyNames.labels.CNAME),
    rpcClient.getVdxfId(keyNames.labels.TXT),
    rpcClient.getVdxfId(keyNames.labels.REDIRECT),
    rpcClient.getVdxfId(keyNames.labels.PROXY),
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
      TLSA: tlsa
    }
  };
}
