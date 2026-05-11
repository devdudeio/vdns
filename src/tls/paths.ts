import path from "node:path";

export type VdnsTlsPaths = {
  stateDir: string;
  caDir: string;
  certDir: string;
  caCert: string;
  caKey: string;
};

export function deriveTlsPaths(env: NodeJS.ProcessEnv = process.env): VdnsTlsPaths {
  const home = env.VDNS_HOME ?? process.cwd();
  const installMode = env.VDNS_INSTALL_MODE ?? (home.includes("/Cellar/vdns/") ? "homebrew" : "checkout");
  const stateDir = env.VDNS_STATE_DIR ?? (installMode === "homebrew" ? path.join(env.HOME ?? home, ".vdns") : path.join(home, ".vdns"));
  const caDir = env.VDNS_TLS_CA_DIR ?? path.join(stateDir, "ca");
  const certDir = env.VDNS_TLS_CERT_DIR ?? path.join(stateDir, "certs");
  return {
    stateDir,
    caDir,
    certDir,
    caCert: path.join(caDir, "vdns-local-root-ca.pem"),
    caKey: path.join(caDir, "vdns-local-root-ca-key.pem")
  };
}

export function hostCertPaths(paths: Pick<VdnsTlsPaths, "certDir">, hostname: string): { dir: string; cert: string; key: string } {
  const dir = path.join(paths.certDir, hostname);
  return {
    dir,
    cert: path.join(dir, "cert.pem"),
    key: path.join(dir, "key.pem")
  };
}
