import { describe, expect, it } from "vitest";
import { validateProxyTargetUrl } from "../src/redirect/proxySecurity.js";

describe("validateProxyTargetUrl", () => {
  it.each([
    "https://verus.io/",
    "http://example.com/path"
  ])("accepts valid target %s", (target) => {
    expect(validateProxyTargetUrl(target, "verus.vdns")).toBeInstanceOf(URL);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/plain,hello",
    "file:///etc/passwd",
    "ftp://example.com/",
    "ws://example.com/",
    "wss://example.com/",
    "gopher://example.com/"
  ])("rejects invalid scheme %s", (target) => {
    expect(validateProxyTargetUrl(target, "verus.vdns")).toBeInstanceOf(Error);
  });

  it.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://127.1.2.3/",
    "http://0.0.0.0/",
    "http://10.0.0.1/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "http://169.254.1.1/",
    "http://[::1]/",
    "http://[fc00::1]/",
    "http://[fe80::1]/"
  ])("rejects local or internal target %s", (target) => {
    expect(validateProxyTargetUrl(target, "verus.vdns")).toBeInstanceOf(Error);
  });

  it("rejects same-host and subdomain loops", () => {
    expect(validateProxyTargetUrl("https://verus.vdns/", "verus.vdns")).toBeInstanceOf(Error);
    expect(validateProxyTargetUrl("https://www.verus.vdns/", "verus.vdns")).toBeInstanceOf(Error);
  });

  it("allows private targets only when explicitly requested", () => {
    expect(validateProxyTargetUrl("http://127.0.0.1:9000/", "verus.vdns", { allowPrivateTargets: true })).toBeInstanceOf(URL);
  });
});
