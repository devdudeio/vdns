import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "dotenv";
import { applyVdnsEnvCompatibility } from "../envCompat.js";
import type { DoctorContext } from "./types.js";

export async function loadDoctorContext(argv: string[], processEnv: NodeJS.ProcessEnv = process.env): Promise<DoctorContext> {
  const strict = argv.includes("--strict");
  const requireHttps = argv.includes("--https") || (processEnv.VDNS_DOCTOR_REQUIRE_HTTPS ?? "").toLowerCase() === "true";
  const home = processEnv.VDNS_HOME ?? process.cwd();
  const installMode = processEnv.VDNS_INSTALL_MODE ?? inferInstallMode(home);
  const stateDir = processEnv.VDNS_STATE_DIR ?? (installMode === "homebrew" ? path.join(processEnv.HOME ?? home, ".vdns") : path.join(home, ".vdns"));
  const envFile = processEnv.VDNS_ENV_FILE ?? (installMode === "homebrew" ? path.join(stateDir, ".env.local") : path.join(home, ".env.local"));
  const logDir = processEnv.VDNS_LOG_DIR ?? path.join(stateDir, "logs");
  const pidDir = processEnv.VDNS_PID_DIR ?? path.join(stateDir, "pids");
  const fileEnv = await readEnvFile(envFile);
  const env = applyVdnsEnvCompatibility({ ...fileEnv, ...processEnv });
  const version = await readVersion(home);

  return { strict, requireHttps, home, installMode, stateDir, envFile, logDir, pidDir, version, env };
}

async function readEnvFile(envFile: string): Promise<Record<string, string>> {
  try {
    return parse(await readFile(envFile));
  } catch {
    return {};
  }
}

async function readVersion(home: string): Promise<string> {
  try {
    const pkg = JSON.parse(await readFile(path.join(home, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function inferInstallMode(home: string): string {
  return home.includes("/Cellar/vdns/") || home.endsWith("/opt/vdns") || home.includes("/opt/vdns/")
    ? "homebrew"
    : "checkout";
}
