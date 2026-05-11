package vdns

import (
	"fmt"
	"time"

	"github.com/coredns/caddy"
	"github.com/coredns/coredns/core/dnsserver"
	"github.com/coredns/coredns/plugin"
)

func init() {
	plugin.Register("vdns", setup)
}

func setup(c *caddy.Controller) error {
	cfg, err := parseConfig(c)
	if err != nil {
		return plugin.Error("vdns", err)
	}

	serverConfig := dnsserver.GetConfig(c)
	serverConfig.AddPlugin(func(next plugin.Handler) plugin.Handler {
		return VDNS{
			Next:   next,
			Zones:  []string{serverConfig.Zone},
			Client: NewClient(cfg.ResolverURL, cfg.Timeout),
		}
	})

	return nil
}

func parseConfig(c *caddy.Controller) (Config, error) {
	cfg := Config{Timeout: defaultTimeout}

	for c.Next() {
		if len(c.RemainingArgs()) > 0 {
			return cfg, c.ArgErr()
		}

		for c.NextBlock() {
			switch c.Val() {
			case "resolver_url":
				if !c.NextArg() {
					return cfg, c.ArgErr()
				}
				cfg.ResolverURL = c.Val()
				if c.NextArg() {
					return cfg, c.ArgErr()
				}
			case "timeout":
				if !c.NextArg() {
					return cfg, c.ArgErr()
				}
				timeout, err := time.ParseDuration(c.Val())
				if err != nil {
					return cfg, fmt.Errorf("invalid timeout: %w", err)
				}
				cfg.Timeout = timeout
				if c.NextArg() {
					return cfg, c.ArgErr()
				}
			default:
				return cfg, c.Errf("unknown vdns option %q", c.Val())
			}
		}
	}

	return cfg, cfg.validate()
}
