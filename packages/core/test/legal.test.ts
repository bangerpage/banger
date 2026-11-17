import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("legal", () => {
  it("LICENSE is MIT with the copyright holder", () => {
    const license = readFileSync(join(root, "LICENSE"), "utf8");
    expect(license).toMatch(/MIT License/);
    expect(license).toContain("Sotaro Karasawa");
  });

  it("NOTICE carries the Apache ECharts notice", () => {
    expect(readFileSync(join(root, "NOTICE"), "utf8")).toContain("Apache ECharts");
  });

  it("copy-legal copies LICENSE and NOTICE into the working directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "banger-legal-"));
    try {
      execFileSync(process.execPath, [join(root, "scripts/copy-legal.mjs")], { cwd: dir });
      expect(existsSync(join(dir, "LICENSE"))).toBe(true);
      expect(existsSync(join(dir, "NOTICE"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
