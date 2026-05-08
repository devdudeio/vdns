package vns

import (
	"context"
	"errors"
	"net/http"

	"github.com/coredns/coredns/plugin"
	"github.com/coredns/coredns/plugin/pkg/log"
	"github.com/coredns/coredns/request"
	"github.com/miekg/dns"
)

var logger = log.NewWithPlugin("vns")

type VNS struct {
	Next   plugin.Handler
	Zones  []string
	Client resolverClient
}

type resolverClient interface {
	ResolveDomain(ctx context.Context, domain string, qtype string) (*ResolveResult, error)
}

func (v VNS) Name() string { return "vns" }

func (v VNS) ServeDNS(ctx context.Context, w dns.ResponseWriter, r *dns.Msg) (int, error) {
	if len(r.Question) == 0 {
		return dns.RcodeFormatError, nil
	}

	state := request.Request{W: w, Req: r}
	if !v.handlesZone(state.Name()) {
		return plugin.NextOrFailure(v.Name(), v.Next, ctx, w, r)
	}

	qtypeName, ok := supportedType(state.QType())
	if !ok {
		return writeResponse(w, r, dns.RcodeSuccess, nil), nil
	}

	result, err := v.Client.ResolveDomain(ctx, normalizeQName(state.Name()), qtypeName)
	if err != nil {
		var statusErr HTTPStatusError
		if errors.As(err, &statusErr) {
			if statusErr.StatusCode == http.StatusNotFound {
				return writeResponse(w, r, dns.RcodeNameError, nil), nil
			}
			logger.Warningf("resolver returned HTTP %d for %s %s", statusErr.StatusCode, state.Name(), qtypeName)
			return writeResponse(w, r, dns.RcodeServerFailure, nil), nil
		}
		logger.Warningf("resolver request failed for %s %s: %v", state.Name(), qtypeName, err)
		return writeResponse(w, r, dns.RcodeServerFailure, nil), nil
	}

	answers := recordsToRRs(state.Name(), result.Records)
	if len(result.Records) > 0 && len(answers) == 0 {
		logger.Warningf("resolver returned only invalid %s records for %s", qtypeName, state.Name())
		return writeResponse(w, r, dns.RcodeServerFailure, nil), nil
	}

	return writeResponse(w, r, dns.RcodeSuccess, answers), nil
}

func (v VNS) handlesZone(qname string) bool {
	for _, zone := range v.Zones {
		if dns.IsSubDomain(dns.Fqdn(zone), dns.Fqdn(qname)) {
			return true
		}
	}
	return false
}

func writeResponse(w dns.ResponseWriter, r *dns.Msg, rcode int, answers []dns.RR) int {
	msg := new(dns.Msg)
	msg.SetReply(r)
	msg.Authoritative = true
	msg.RecursionAvailable = false
	msg.Rcode = rcode
	msg.Answer = answers
	if err := w.WriteMsg(msg); err != nil {
		return dns.RcodeServerFailure
	}
	return rcode
}
