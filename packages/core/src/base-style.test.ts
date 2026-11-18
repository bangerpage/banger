import { afterEach, describe, expect, it, vi } from "vitest";

describe("loadFonts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("gives up within one timeout even when every font promise hangs", async () => {
    const { loadFonts } = await import("./base-style.js");
    vi.useFakeTimers();
    const never = new Promise<never>(() => {});
    vi.stubGlobal("document", { fonts: { load: () => never, ready: never } });
    let warnings: string[] | undefined;
    void loadFonts("x", 1000).then((w) => (warnings = w));
    await vi.advanceTimersByTimeAsync(1100);
    expect(warnings).toEqual(["fonts timed out"]);
  });
});
