package vns

import (
	"errors"
	"net/url"
	"time"
)

const defaultTimeout = 3 * time.Second

type Config struct {
	ResolverURL string
	Timeout     time.Duration
}

func (c Config) validate() error {
	if c.ResolverURL == "" {
		return errors.New("resolver_url is required")
	}
	if _, err := url.ParseRequestURI(c.ResolverURL); err != nil {
		return err
	}
	if c.Timeout <= 0 {
		return errors.New("timeout must be positive")
	}
	return nil
}
