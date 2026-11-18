import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "./bin.js";

let stdout = "";
let stderr = "";

beforeEach(() => {
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("bin", () => {
  it.each([
    ["no command", []],
    ["unknown command", ["frobnicate"]],
    ["snap without a file", ["snap"]],
    ["dev without a file", ["dev"]],
    ["export without a file", ["export"]],
    ["snap on a missing file", ["snap", "/nonexistent/deck.html"]],
    ["export on a missing file", ["export", "/nonexistent/deck.html", "--pdf"]],
    ["export without a format", ["export", "deck.html"]],
    ["export with two formats", ["export", "deck.html", "--pdf", "--png"]],
    ["export with a bad --steps", ["export", "deck.html", "--pdf", "--steps", "some"]],
    ["snap with a bad --scale", ["snap", "deck.html", "--scale", "3"]],
    ["snap with a bad --stop", ["snap", "deck.html", "--stop", "x"]],
    ["theme without a subcommand", ["theme"]],
    ["theme with an unknown subcommand", ["theme", "frob"]],
    ["theme apply without files", ["theme", "apply"]],
    ["theme init with an unknown preset", ["theme", "init", "--from", "nope"]],
    ["unknown option", ["snap", "deck.html", "--nope"]],
  ])("%s exits 2 with a banger: message", async (_name, argv) => {
    expect(await main(argv)).toBe(2);
    expect(stderr.startsWith("banger: ")).toBe(true);
  });

  it("--help and --version exit 0", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(stdout).toContain("usage: banger");
    expect(stdout).toContain("theme init");
    expect(stdout).toContain("theme apply");
    stdout = "";
    expect(await main(["--version"])).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
