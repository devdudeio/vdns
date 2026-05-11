import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, "..");

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(full);
    }
    return [full];
  }));
  return files.flat();
}

describe("packaging scripts", () => {
  it("bash scripts have valid syntax", async () => {
    const candidates = [
      path.join(repoRoot, "bin", "vdns"),
      ...(await collectFiles(path.join(repoRoot, "scripts"))).filter((file) => file.endsWith(".sh"))
    ];
    await execFileAsync("bash", ["-n", ...candidates], { cwd: repoRoot });
  });

  it("does not hardcode old local checkout paths in executable packaging files", async () => {
    const roots = ["bin", "scripts", "packaging"];
    const files = (await Promise.all(roots.map((root) => collectFiles(path.join(repoRoot, root))))).flat();
    const forbidden = [
      ["/Users/robertlech", "Documents", "vdns"].join("/"),
      ["/Users/robertlech", "Developer", "vdns"].join("/")
    ];

    for (const file of files) {
      if ((await stat(file)).isDirectory()) continue;
      const contents = await readFile(file, "utf8");
      for (const needle of forbidden) {
        expect(contents, `${path.relative(repoRoot, file)} contains ${needle}`).not.toContain(needle);
      }
    }
  });
});
