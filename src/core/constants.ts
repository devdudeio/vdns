export const VDNS_VDXF_KEYS = {
  RECORD: "vdns.vdns::vdns.record",
  DNS_A: "vdns.vdns::vdns.dns.a",
  DNS_AAAA: "vdns.vdns::vdns.dns.aaaa",
  DNS_CNAME: "vdns.vdns::vdns.dns.cname",
  DNS_TXT: "vdns.vdns::vdns.dns.txt",
  WEB_REDIRECT: "vdns.vdns::vdns.web.redirect",
  WEB_PROXY: "vdns.vdns::vdns.web.proxy",
  WEB_SITE: "vdns.vdns::vdns.web.site",
  TLS_FINGERPRINT: "vdns.vdns::vdns.tls.fingerprint"
} as const;

export const LEGACY_VDNS_VDXF_KEYS = {
  RECORD: "VDNS.vdns::record",
  DNS_A: "VDNS.vdns::dns.a",
  DNS_AAAA: "VDNS.vdns::dns.aaaa",
  DNS_CNAME: "VDNS.vdns::dns.cname",
  DNS_TXT: "VDNS.vdns::dns.txt",
  WEB_REDIRECT: "VDNS.vdns::web.redirect",
  WEB_PROXY: "VDNS.vdns::web.proxy",
  WEB_SITE: "VDNS.vdns::web.site",
  TLS_FINGERPRINT: "VDNS.vdns::tls.fingerprint"
} as const;

export const LEGACY_VNS_VDXF_KEYS = {
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
