package vdns

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type ResolveResult struct {
	Identity string      `json:"identity"`
	Domain   string      `json:"domain"`
	Host     string      `json:"host"`
	Records  []VDNSRecord `json:"records"`
	Warnings []string    `json:"warnings"`
}

type VDNSRecord struct {
	Version int    `json:"version"`
	Name    string `json:"name"`
	TTL     uint32 `json:"ttl"`
	Type    string `json:"type"`
	Value   string `json:"value"`
}

type HTTPStatusError struct {
	StatusCode int
}

func (e HTTPStatusError) Error() string {
	return fmt.Sprintf("vdns resolver returned HTTP %d", e.StatusCode)
}

func NewClient(resolverURL string, timeout time.Duration) *Client {
	return &Client{
		baseURL: strings.TrimRight(resolverURL, "/"),
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}
}

func (c *Client) ResolveDomain(ctx context.Context, domain string, qtype string) (*ResolveResult, error) {
	endpoint := fmt.Sprintf("%s/resolve-domain/%s?type=%s", c.baseURL, url.PathEscape(domain), url.QueryEscape(qtype))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, HTTPStatusError{StatusCode: resp.StatusCode}
	}

	var result ResolveResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}

	return &result, nil
}
