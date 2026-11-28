import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../errors.js";
import { MARKER, NEXT_STEPS, installSkill, packSkill } from "./skill.js";
import { inflateRawSync } from "node:zlib";

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

  it("never replaces a folder that is not a skill, even with --force", () => {
    mkdirSync(join(dest, "other-skill"), { recursive: true });
    writeFileSync(join(dest, "other-skill", "SKILL.md"), "other");
    expect(() => installSkill({ source, dest, version: "0.1.0", force: true })).toThrow(/not a skill folder/);
    expect(readFileSync(join(dest, "other-skill", "SKILL.md"), "utf8")).toBe("other");
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

/** Reads the entries of an archive written by `createZip` through its central directory. */
function readZip(zip: Buffer): Record<string, string> {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  const count = zip.readUInt16LE(end + 10);
  let at = zip.readUInt32LE(end + 16);
  const files: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const size = zip.readUInt32LE(at + 20);
    const nameLength = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const data = local + 30 + zip.readUInt16LE(local + 26);
    files[name] = inflateRawSync(zip.subarray(data, data + size)).toString("utf8");
    at += 46 + nameLength;
  }
  return files;
}

describe("packSkill", () => {
  it("writes the skill under one top-level banger folder", () => {
    const out = join(dir, "banger-skill.zip");
    packSkill(source, out);
    expect(readZip(readFileSync(out))).toEqual({
      "banger/SKILL.md": "skill",
      "banger/reference/components.md": "components",
    });
  });

  it("makes the same archive from the same files", () => {
    packSkill(source, join(dir, "a.zip"));
    packSkill(source, join(dir, "b.zip"));
    expect(readFileSync(join(dir, "a.zip")).equals(readFileSync(join(dir, "b.zip")))).toBe(true);
  });

  it("refuses a source without SKILL.md", () => {
    rmSync(join(source, "SKILL.md"));
    expect(() => packSkill(source, join(dir, "x.zip"))).toThrow(CliError);
  });
});
