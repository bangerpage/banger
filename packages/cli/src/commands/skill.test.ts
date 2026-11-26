import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../errors.js";
import { MARKER, NEXT_STEPS, installSkill } from "./skill.js";

let dir: string;
let source: string;
let dest: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banger-skill-"));
  source = join(dir, "source");
  mkdirSync(join(source, "reference"), { recursive: true });
  writeFileSync(join(source, "SKILL.md"), "skill");
  writeFileSync(join(source, "reference", "components.md"), "components");
  dest = join(dir, "home", ".claude", "skills", "banger");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("installSkill", () => {
  it("copies the skill and marks the copy with the CLI version", () => {
    expect(installSkill({ source, dest, version: "0.1.0" })).toBe("installed");
    expect(readFileSync(join(dest, "reference", "components.md"), "utf8")).toBe("components");
    expect(readFileSync(join(dest, MARKER), "utf8")).toBe("0.1.0\n");
  });

  it("replaces an earlier install and drops files the new skill no longer has", () => {
    installSkill({ source, dest, version: "0.1.0" });
    writeFileSync(join(dest, "stale.md"), "old");
    expect(installSkill({ source, dest, version: "0.2.0" })).toBe("updated");
    expect(existsSync(join(dest, "stale.md"))).toBe(false);
    expect(readFileSync(join(dest, MARKER), "utf8")).toBe("0.2.0\n");
  });

  it("refuses to replace a directory it did not write unless forced", () => {
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "SKILL.md"), "mine");
    expect(() => installSkill({ source, dest, version: "0.1.0" })).toThrow(CliError);
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("mine");
    expect(installSkill({ source, dest, version: "0.1.0", force: true })).toBe("updated");
    expect(readFileSync(join(dest, "SKILL.md"), "utf8")).toBe("skill");
  });

  it("fails with exit code 2 when the bundled skill is missing", () => {
    try {
      installSkill({ source: join(dir, "nowhere"), dest, version: "0.1.0" });
      expect.unreachable();
    } catch (error) {
      expect((error as CliError).exitCode).toBe(2);
    }
  });
});

describe("NEXT_STEPS", () => {
  it("names what the skill does, a first request, how to preview and where to read more", () => {
    expect(NEXT_STEPS).toMatch(/flow of stops/);
    expect(NEXT_STEPS).toMatch(/PDF/);
    expect(NEXT_STEPS).toMatch(/"Make a 10-minute talk/);
    expect(NEXT_STEPS).toContain("`banger preview`");
    expect(NEXT_STEPS).toContain("https://banger.page/start");
  });
});
