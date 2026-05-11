export const VNS_VDXF_KEYS = {
  RECORD: "VNS.vrsc::record",
  DNS_A: "VNS.vrsc::dns.a",
  DNS_AAAA: "VNS.vrsc::dns.aaaa",
  DNS_CNAME: "VNS.vrsc::dns.cname",
  DNS_TXT: "VNS.vrsc::dns.txt",
  WEB_REDIRECT: "VNS.vrsc::web.redirect",
  WEB_PROXY: "VNS.vrsc::web.proxy",
  WEB_SITE: "VNS.vrsc::web.site",
  TLS_FINGERPRINT: "VNS.vrsc::tls.fingerprint"
} as const;

export const VERUS_DATA_DESCRIPTOR_KEY = "i4GC1YGEVD21afWudGoFJVdnfjJ5XWnCQv";

export const SUPPORTED_RECORD_TYPES = [
  "A",
  "AAAA",
  "CNAME",
  "TXT",
  "REDIRECT",
  "PROXY",
  "SITE",
  "TLSA"
] as const;
