import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate, isNewer, updateCacheFile } from "./update-check.js";

const DAY = 24 * 60 * 60 * 1000;
let dir: string;
let cacheFile: string;
let output: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "banger-update-"));
  cacheFile = join(dir, "nested", "update-check.json");
  output = "";
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(opts: { env?: NodeJS.ProcessEnv; isTTY?: boolean; now?: number; latest?: string | Error } = {}) {
  const fetchLatest = vi.fn(async () => {
    if (opts.latest instanceof Error) throw opts.latest;
    return opts.latest;
  });
  const done = checkForUpdate({
    current: "0.1.0",
    env: opts.env ?? {},
    isTTY: opts.isTTY ?? true,
    now: opts.now ?? 10 * DAY,
    cacheFile,
    fetchLatest,
    write: (text) => {
      output += text;
    },
  });
  return { done, fetchLatest };
}

function seed(latest: string, checkedAt: number) {
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ checkedAt, latest }));
}

describe("isNewer", () => {
  it.each([
    ["0.2.0", "0.1.0", true],
    ["0.1.1", "0.1.0", true],
    ["1.0.0", "0.9.9", true],
    ["0.1.0", "0.1.0", false],
    ["0.0.9", "0.1.0", false],
    ["0.2.0-beta.1", "0.1.0", false],
    ["0.2.0", "0.0.0-dev", false],
  ])("%s over %s is %s", (latest, current, expected) => {
    expect(isNewer(latest, current)).toBe(expected);
  });
});

describe("checkForUpdate", () => {
  it("fetches on the first run, prints nothing, and caches the result", async () => {
    const { done, fetchLatest } = run({ latest: "0.2.0" });
    await done;
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(output).toBe("");
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual({ checkedAt: 10 * DAY, latest: "0.2.0" });
  });

  it("prints a notice from the cache and skips the fetch within a day", async () => {
    seed("0.2.0", 10 * DAY - 1000);
    const { done, fetchLatest } = run({ latest: "0.3.0" });
    await done;
    expect(output).toBe(
      "banger: 0.2.0 is available (you have 0.1.0). Update with: npm install -g @bangerpage/cli@latest\n",
    );
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("refreshes a cache older than a day", async () => {
    seed("0.1.0", 10 * DAY - DAY - 1);
    const { done, fetchLatest } = run({ latest: "0.3.0" });
    await done;
    expect(output).toBe("");
    expect(fetchLatest).toHaveBeenCalledOnce();
    expect(JSON.parse(readFileSync(cacheFile, "utf8")).latest).toBe("0.3.0");
  });

  it("keeps the old cache when the fetch fails", async () => {
    seed("0.1.0", 0);
    await run({ latest: new Error("offline") }).done;
    expect(JSON.parse(readFileSync(cacheFile, "utf8"))).toEqual({ checkedAt: 0, latest: "0.1.0" });
  });

  it("ignores a corrupt cache", async () => {
    seed("0.2.0", 0);
    writeFileSync(cacheFile, "{not json");
    const { done, fetchLatest } = run({ latest: "0.2.0" });
    await done;
    expect(output).toBe("");
    expect(fetchLatest).toHaveBeenCalledOnce();
  });

  it.each([
    ["stderr is not a terminal", { isTTY: false }],
    ["CI is set", { env: { CI: "true" } }],
    ["BANGER_NO_UPDATE_CHECK is set", { env: { BANGER_NO_UPDATE_CHECK: "1" } }],
    ["NO_UPDATE_NOTIFIER is set", { env: { NO_UPDATE_NOTIFIER: "1" } }],
  ])("does nothing when %s", async (_name, opts) => {
    seed("0.2.0", 0);
    const { done, fetchLatest } = run({ ...opts, latest: "0.3.0" });
    await done;
    expect(output).toBe("");
    expect(fetchLatest).not.toHaveBeenCalled();
  });
});

describe("updateCacheFile", () => {
  it("uses XDG_CACHE_HOME when it is set", () => {
    expect(updateCacheFile({ XDG_CACHE_HOME: "/x" })).toBe(join("/x", "banger", "update-check.json"));
  });
});
