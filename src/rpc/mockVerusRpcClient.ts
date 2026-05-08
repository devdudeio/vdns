import { readFile } from "node:fs/promises";
import path from "node:path";
import type { IdentityPayload, VerusRpcLike } from "../core/types.js";

export class MockVerusRpcClient implements VerusRpcLike {
  constructor(private readonly fixturesDir = defaultFixturesDir()) {}

  async getIdentity(identity: string): Promise<IdentityPayload | null> {
    const raw = await this.getRawIdentity(identity);
    return raw as IdentityPayload | null;
  }

  async getRawIdentity(identity: string): Promise<unknown | null> {
    const filename = `${identity.replace(/@$/, "")}.json`;
    const fixturePath = path.join(this.fixturesDir, filename);

    try {
      const raw = await readFile(fixturePath, "utf8");
      return JSON.parse(raw) as unknown;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async getVdxfId(key: string): Promise<string> {
    return key;
  }
}

function defaultFixturesDir(): string {
  return path.resolve(process.cwd(), "fixtures/identities");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
