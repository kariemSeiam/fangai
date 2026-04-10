import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
/** Built entry (run `pnpm build` in this package before tests if missing). */
const cliEntry = join(here, "..", "..", "dist", "index.js");

describe("fang CLI smoke", () => {
  it("--help exits 0 and prints usage", () => {
    const out = execFileSync(process.execPath, [cliEntry, "--help"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(out).toMatch(/fang/i);
    expect(out).toMatch(/wrap|Usage|Options/i);
  });

  it("--version exits 0 with semver", () => {
    const out = execFileSync(process.execPath, [cliEntry, "--version"], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
