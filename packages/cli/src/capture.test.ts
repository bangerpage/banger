import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearStopFiles, expandStates, stopFileName } from "./capture.js";

const path = [{ steps: 0 }, { steps: 2 }];

describe("capture", () => {
  it("expandStates", () => {
    expect(expandStates(path, "last")).toEqual([
      { stop: 0, step: 0 },
      { stop: 1, step: 2 },
    ]);
    expect(expandStates(path, "all")).toEqual([
      { stop: 0, step: 0 },
      { stop: 1, step: 0 },
      { stop: 1, step: 1 },
      { stop: 1, step: 2 },
    ]);
    expect(expandStates(path, "all", { stop: 1, step: 1 })).toEqual([{ stop: 1, step: 1 }]);
  });

  it("stopFileName", () => {
    expect(stopFileName(3, 12)).toBe("stop-003-step-012.png");
  });

  describe("clearStopFiles", () => {
    let dir = "";
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("removes only matching files directly in the directory", async () => {
      dir = await mkdtemp(join(tmpdir(), "banger-clear-"));
      const keep = ["notes.txt", "stop-1-step-1.png", "stop-000-step-000.png.bak"];
      for (const name of [...keep, "stop-000-step-000.png", "stop-004-step-001.png"]) await writeFile(join(dir, name), "x");
      await mkdir(join(dir, "sub"));
      await writeFile(join(dir, "sub", "stop-000-step-000.png"), "x");

      expect((await clearStopFiles(dir)).sort()).toEqual(["stop-000-step-000.png", "stop-004-step-001.png"]);
      expect((await readdir(dir)).sort()).toEqual([...keep, "sub"].sort());
      expect(await readdir(join(dir, "sub"))).toEqual(["stop-000-step-000.png"]);
    });

    it("does nothing for a missing directory", async () => {
      dir = join(tmpdir(), "banger-clear-missing-dir");
      await expect(clearStopFiles(dir)).resolves.toEqual([]);
    });
  });
});
