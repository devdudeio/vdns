import { formatResults } from "./format.js";
import { loadDoctorContext } from "./context.js";
import { runDoctorChecks } from "./checks.js";
import { summarize } from "./types.js";

function usage(): string {
  return `vdns doctor

Usage:
  vdns doctor [--strict]

Runs install, config, RPC, service, DNS, web, record, and log diagnostics.

Options:
  --strict   Treat demo DNS/REDIRECT/PROXY warnings as failures
  -h, --help Show this help
`;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    process.stdout.write(usage());
    return;
  }
  const ctx = await loadDoctorContext(args);
  const results = await runDoctorChecks(ctx);
  process.stdout.write(formatResults(results));
  process.exitCode = summarize(results).exitCode;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`vdns doctor failed: ${message}\n`);
  process.exitCode = 1;
});

