package vdns

import (
	"net"
	"strings"

	"github.com/miekg/dns"
)

const fallbackTTL uint32 = 300

func supportedType(qtype uint16) (string, bool) {
	switch qtype {
	case dns.TypeA:
		return "A", true
	case dns.TypeAAAA:
		return "AAAA", true
	case dns.TypeCNAME:
		return "CNAME", true
	case dns.TypeTXT:
		return "TXT", true
	default:
		return "", false
	}
}

func recordsToRRs(qname string, records []VDNSRecord) []dns.RR {
	rrs := make([]dns.RR, 0, len(records))
	for _, record := range records {
		if rr := recordToRR(qname, record); rr != nil {
			rrs = append(rrs, rr)
		}
	}
	return rrs
}

func recordToRR(qname string, record VDNSRecord) dns.RR {
	header := dns.RR_Header{
		Name:   dns.Fqdn(qname),
		Rrtype: dns.StringToType[record.Type],
		Class:  dns.ClassINET,
		Ttl:    normalizeTTL(record.TTL),
	}

	switch record.Type {
	case "A":
		ip := net.ParseIP(record.Value)
		if ip == nil || ip.To4() == nil {
			return nil
		}
		return &dns.A{Hdr: header, A: ip.To4()}
	case "AAAA":
		ip := net.ParseIP(record.Value)
		if ip == nil || ip.To4() != nil || ip.To16() == nil {
			return nil
		}
		return &dns.AAAA{Hdr: header, AAAA: ip.To16()}
	case "CNAME":
		target := strings.TrimSpace(record.Value)
		if target == "" {
			return nil
		}
		return &dns.CNAME{Hdr: header, Target: dns.Fqdn(target)}
	case "TXT":
		return &dns.TXT{Hdr: header, Txt: []string{record.Value}}
	default:
		return nil
	}
}

func normalizeTTL(ttl uint32) uint32 {
	if ttl == 0 {
		return fallbackTTL
	}
	return ttl
}

func normalizeQName(qname string) string {
	return strings.TrimSuffix(strings.ToLower(qname), ".")
}
