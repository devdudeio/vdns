export type CheckStatus = "PASS" | "WARN" | "FAIL";

export type CheckResult = {
  section: string;
  status: CheckStatus;
  label: string;
  message: string;
  details?: string[] | undefined;
  fix?: string | undefined;
  strictFailure?: boolean | undefined;
};

export type DoctorContext = {
  strict: boolean;
  requireHttps: boolean;
  home: string;
  installMode: string;
  stateDir: string;
  envFile: string;
  logDir: string;
  pidDir: string;
  version: string;
  env: Record<string, string | undefined>;
};

export const sections = [
  "Install",
  "Config",
  "Verus RPC",
  "Services",
  "macOS DNS",
  "Web",
  "HTTPS",
  "Records",
  "Logs",
  "Summary"
] as const;

export function applyStrict(result: CheckResult, strict: boolean): CheckResult {
  if (strict && result.strictFailure && result.status === "WARN") {
    return { ...result, status: "FAIL" };
  }
  return result;
}

export function summarize(results: CheckResult[]): { pass: number; warn: number; fail: number; exitCode: 0 | 1 } {
  const pass = results.filter((result) => result.status === "PASS").length;
  const warn = results.filter((result) => result.status === "WARN").length;
  const fail = results.filter((result) => result.status === "FAIL").length;
  return { pass, warn, fail, exitCode: fail > 0 ? 1 : 0 };
}
