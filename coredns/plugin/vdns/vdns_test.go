package vdns

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/coredns/caddy"
	"github.com/coredns/coredns/plugin/pkg/dnstest"
	"github.com/coredns/coredns/plugin/test"
	"github.com/miekg/dns"
)

func TestParseConfig(t *testing.T) {
	controller := caddy.NewTestController("dns", `vdns {
		resolver_url http://127.0.0.1:8080
		timeout 5s
	}`)

	cfg, err := parseConfig(controller)
	if err != nil {
		t.Fatalf("parseConfig returned error: %v", err)
	}

	if cfg.ResolverURL != "http://127.0.0.1:8080" {
		t.Fatalf("unexpected resolver_url %q", cfg.ResolverURL)
	}
	if cfg.Timeout != 5*time.Second {
		t.Fatalf("unexpected timeout %s", cfg.Timeout)
	}
}

func TestParseConfigRequiresResolverURL(t *testing.T) {
	controller := caddy.NewTestController("dns", `vdns`)

	if _, err := parseConfig(controller); err == nil {
		t.Fatal("expected resolver_url validation error")
	}
}

func TestNormalizeQName(t *testing.T) {
	if got := normalizeQName("Google.VDNS."); got != "google.vdns" {
		t.Fatalf("unexpected qname normalization: %q", got)
	}
}

func TestRecordConversions(t *testing.T) {
	tests := []struct {
		name   string
		record VDNSRecord
		qtype  uint16
		want   string
	}{
		{
			name:   "A",
			record: VDNSRecord{Type: "A", Value: "142.250.181.238", TTL: 300},
			qtype:  dns.TypeA,
			want:   "google.vdns.\t300\tIN\tA\t142.250.181.238",
		},
		{
			name:   "AAAA",
			record: VDNSRecord{Type: "AAAA", Value: "2001:db8::1", TTL: 300},
			qtype:  dns.TypeAAAA,
			want:   "google.vdns.\t300\tIN\tAAAA\t2001:db8::1",
		},
		{
			name:   "CNAME",
			record: VDNSRecord{Type: "CNAME", Value: "target.example.com", TTL: 300},
			qtype:  dns.TypeCNAME,
			want:   "www.google.vdns.\t300\tIN\tCNAME\ttarget.example.com.",
		},
		{
			name:   "TXT",
			record: VDNSRecord{Type: "TXT", Value: "hello=vdns", TTL: 300},
			qtype:  dns.TypeTXT,
			want:   "google.vdns.\t300\tIN\tTXT\t\"hello=vdns\"",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			qname := "google.vdns."
			if tt.name == "CNAME" {
				qname = "www.google.vdns."
			}
			rr := recordToRR(qname, tt.record)
			if rr == nil {
				t.Fatal("recordToRR returned nil")
			}
			if rr.Header().Rrtype != tt.qtype {
				t.Fatalf("unexpected qtype %d", rr.Header().Rrtype)
			}
			if rr.String() != tt.want {
				t.Fatalf("unexpected RR\nwant: %s\n got: %s", tt.want, rr.String())
			}
		})
	}
}

func TestServeDNSSupportedQTypes(t *testing.T) {
	tests := []struct {
		name     string
		qname    string
		qtype    uint16
		response string
		wantType uint16
	}{
		{"A", "google.vdns.", dns.TypeA, recordResponse(`{"version":1,"name":"@","ttl":300,"type":"A","value":"142.250.181.238"}`), dns.TypeA},
		{"AAAA", "google.vdns.", dns.TypeAAAA, recordResponse(`{"version":1,"name":"@","ttl":300,"type":"AAAA","value":"2001:db8::1"}`), dns.TypeAAAA},
		{"CNAME", "www.google.vdns.", dns.TypeCNAME, recordResponse(`{"version":1,"name":"www","ttl":300,"type":"CNAME","value":"target.example.com"}`), dns.TypeCNAME},
		{"TXT", "google.vdns.", dns.TypeTXT, recordResponse(`{"version":1,"name":"@","ttl":300,"type":"TXT","value":"hello=vdns"}`), dns.TypeTXT},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("type") != tt.name {
					t.Fatalf("unexpected type query %q", r.URL.Query().Get("type"))
				}
				wantPath := "/resolve-domain/" + normalizeQName(tt.qname)
				if r.URL.Path != wantPath {
					t.Fatalf("unexpected resolver path %q, want %q", r.URL.Path, wantPath)
				}
				fmt.Fprint(w, tt.response)
			}))
			defer server.Close()

			recorder := serveDNS(t, server.URL, tt.qname, tt.qtype)
			if recorder.Msg.Rcode != dns.RcodeSuccess {
				t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
			}
			if len(recorder.Msg.Answer) != 1 {
				t.Fatalf("expected one answer, got %d", len(recorder.Msg.Answer))
			}
			if recorder.Msg.Answer[0].Header().Rrtype != tt.wantType {
				t.Fatalf("unexpected answer type %d", recorder.Msg.Answer[0].Header().Rrtype)
			}
		})
	}
}

func TestServeDNSNoRecordsReturnsNoErrorNoAnswers(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `{"identity":"google.fum@","domain":"google.vdns","host":"@","records":[],"warnings":[]}`)
	}))
	defer server.Close()

	recorder := serveDNS(t, server.URL, "google.vdns.", dns.TypeA)
	if recorder.Msg.Rcode != dns.RcodeSuccess {
		t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
	}
	if len(recorder.Msg.Answer) != 0 {
		t.Fatalf("expected no answers, got %d", len(recorder.Msg.Answer))
	}
}

func TestServeDNSHTTP404ReturnsNXDOMAIN(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer server.Close()

	recorder := serveDNS(t, server.URL, "missing.vdns.", dns.TypeA)
	if recorder.Msg.Rcode != dns.RcodeNameError {
		t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
	}
}

func TestServeDNSHTTP500ReturnsSERVFAIL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "upstream failed", http.StatusInternalServerError)
	}))
	defer server.Close()

	recorder := serveDNS(t, server.URL, "google.vdns.", dns.TypeA)
	if recorder.Msg.Rcode != dns.RcodeServerFailure {
		t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
	}
}

func TestServeDNSUnreachableReturnsSERVFAIL(t *testing.T) {
	v := VDNS{
		Zones:  []string{"vdns."},
		Client: NewClient("http://127.0.0.1:1", 10*time.Millisecond),
	}
	req := new(dns.Msg)
	req.SetQuestion("google.vdns.", dns.TypeA)
	recorder := dnstest.NewRecorder(&test.ResponseWriter{})

	_, _ = v.ServeDNS(context.Background(), recorder, req)
	if recorder.Msg.Rcode != dns.RcodeServerFailure {
		t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
	}
}

func TestUnsupportedQTypeReturnsNoData(t *testing.T) {
	v := VDNS{
		Zones: []string{"vdns."},
		Client: resolverClientFunc(func(ctx context.Context, domain string, qtype string) (*ResolveResult, error) {
			t.Fatal("resolver should not be called for unsupported qtype")
			return nil, nil
		}),
	}
	req := new(dns.Msg)
	req.SetQuestion("google.vdns.", dns.TypeMX)
	recorder := dnstest.NewRecorder(&test.ResponseWriter{})

	_, _ = v.ServeDNS(context.Background(), recorder, req)
	if recorder.Msg.Rcode != dns.RcodeSuccess {
		t.Fatalf("unexpected rcode %d", recorder.Msg.Rcode)
	}
	if len(recorder.Msg.Answer) != 0 {
		t.Fatalf("expected no answers, got %d", len(recorder.Msg.Answer))
	}
}

func serveDNS(t *testing.T, resolverURL string, qname string, qtype uint16) *dnstest.Recorder {
	t.Helper()
	v := VDNS{
		Zones:  []string{"vdns."},
		Client: NewClient(resolverURL, time.Second),
	}
	req := new(dns.Msg)
	req.SetQuestion(qname, qtype)
	recorder := dnstest.NewRecorder(&test.ResponseWriter{})
	_, _ = v.ServeDNS(context.Background(), recorder, req)
	return recorder
}

func recordResponse(record string) string {
	return `{"identity":"google.fum@","domain":"google.vdns","host":"@","records":[` + record + `],"warnings":[]}`
}

type resolverClientFunc func(context.Context, string, string) (*ResolveResult, error)

func (f resolverClientFunc) ResolveDomain(ctx context.Context, domain string, qtype string) (*ResolveResult, error) {
	return f(ctx, domain, qtype)
}
