import { sections, summarize, type CheckResult } from "./types.js";

export function formatResults(results: CheckResult[]): string {
  const lines: string[] = ["vDNS doctor"];

  for (const section of sections) {
    if (section === "Summary") {
      continue;
    }
    const sectionResults = results.filter((result) => result.section === section);
    if (sectionResults.length === 0) {
      continue;
    }

    lines.push("", `== ${section} ==`);
    for (const result of sectionResults) {
      lines.push(`[${result.status}] ${result.label}: ${result.message}`);
      for (const detail of result.details ?? []) {
        lines.push(`  ${redact(detail)}`);
      }
      if (result.fix) {
        lines.push(`  Fix: ${redact(result.fix)}`);
      }
    }
  }

  const summary = summarize(results);
  lines.push("", "== Summary ==");
  lines.push(`[${summary.fail > 0 ? "FAIL" : summary.warn > 0 ? "WARN" : "PASS"}] ${summary.pass} passed, ${summary.warn} warnings, ${summary.fail} failures`);

  return `${lines.map(redact).join("\n")}\n`;
}

export function redact(value: string): string {
  return value
    .replace(/(VERUS_RPC_PASSWORD=)[^\s]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*Basic\s+)[A-Za-z0-9+/=]+/gi, "$1[redacted]")
    .replace(/(Basic\s+)[A-Za-z0-9+/=]+/g, "$1[redacted]");
}

