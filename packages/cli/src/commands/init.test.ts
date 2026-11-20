import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CliError } from "../errors.js";
import { initDeck } from "./init.js";

let dir: string;
let starter: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banger-init-"));
  starter = join(dir, "starter.html");
  writeFileSync(starter, "<bang-root></bang-root>");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("initDeck", () => {
  it("writes index.html into a new directory", () => {
    const target = initDeck({ starter, dir: join(dir, "my-talk") });
    expect(target).toBe(join(dir, "my-talk", "index.html"));
    expect(readFileSync(target, "utf8")).toBe("<bang-root></bang-root>");
  });

  it("keeps an existing index.html unless forced", () => {
    writeFileSync(join(dir, "index.html"), "mine");
    expect(() => initDeck({ starter, dir })).toThrow(CliError);
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("mine");
    initDeck({ starter, dir, force: true });
    expect(readFileSync(join(dir, "index.html"), "utf8")).toBe("<bang-root></bang-root>");
  });
});
