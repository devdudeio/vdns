import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { generateHostCert, initCa } from "../src/tls/certs.js";
import { normalizeVdnsTlsHost, vdnsTlsHostMatches } from "../src/tls/hosts.js";
import { deriveTlsPaths } from "../src/tls/paths.js";

const execFileAsync = promisify(execFile);

describe("vDNS TLS helpers", () => {
  it("validates configured TLD hostnames", () => {
    expect(normalizeVdnsTlsHost("VERUS.VDNS", "vdns")).toBe("verus.vdns");
    expect(normalizeVdnsTlsHost("chainvue.vdns", "vdns")).toBe("chainvue.vdns");
    expect(normalizeVdnsTlsHost("sub.chainvue.vdns", "vdns")).toBe("sub.chainvue.vdns");

    for (const host of ["", "vdns", "bad host.vdns", "verus.vdns:443", "verus.vdns/path", "127.0.0.1", "localhost", "google.com", "verus.vdns.evil.com"]) {
      expect(normalizeVdnsTlsHost(host, "vdns")).toBeInstanceOf(Error);
    }
  });

  it("matches normalized SNI to Host", () => {
    expect(vdnsTlsHostMatches("verus.vdns", "VERUS.VDNS", "vdns")).toBe(true);
    expect(vdnsTlsHostMatches("verus.vdns", "chainvue.vdns", "vdns")).toBe(false);
    expect(vdnsTlsHostMatches("verus.vdns", undefined, "vdns")).toBe(false);
  });

  it("derives paths from VDNS_STATE_DIR", () => {
    const paths = deriveTlsPaths({ VDNS_STATE_DIR: "/tmp/vdns-state" });
    expect(paths.caCert).toBe("/tmp/vdns-state/ca/vdns-local-root-ca.pem");
    expect(paths.caKey).toBe("/tmp/vdns-state/ca/vdns-local-root-ca-key.pem");
    expect(paths.certDir).toBe("/tmp/vdns-state/certs");
  });

  it("creates a CA and host cert with safe key permissions and SAN DNS", async () => {
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "vdns-tls-"));
    try {
      const paths = deriveTlsPaths({ VDNS_STATE_DIR: stateDir });
      await initCa({ paths, hostname: "test-host" });
      const generated = await generateHostCert("verus.vdns", { paths, tld: "vdns" });

      expect((await stat(paths.caKey)).mode & 0o777).toBe(0o600);
      expect((await stat(generated.key)).mode & 0o777).toBe(0o600);

      const { stdout } = await execFileAsync("openssl", ["x509", "-in", generated.cert, "-noout", "-ext", "subjectAltName"]);
      expect(stdout).toContain("DNS:verus.vdns");
    } finally {
      await rm(stateDir, { recursive: true, force: true });
    }
  });
});
