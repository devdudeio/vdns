import { existsSync, readFileSync } from "node:fs";
import dotenv from "dotenv";

export function loadEnvFiles(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): void {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const shellEnvKeys = new Set(Object.keys(env));
  loadEnvFile(`${cwd}/.env`, env, shellEnvKeys);
  loadEnvFile(`${cwd}/.env.local`, env, shellEnvKeys);
}

function loadEnvFile(path: string, env: NodeJS.ProcessEnv, shellEnvKeys: Set<string>): void {
  if (!existsSync(path)) {
    return;
  }

  const parsed = dotenv.parse(readFileSync(path));
  for (const [key, value] of Object.entries(parsed)) {
    if (!shellEnvKeys.has(key)) {
      env[key] = value;
    }
  }
}
