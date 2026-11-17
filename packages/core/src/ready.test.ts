import { describe, expect, it } from "vitest";
import { settleReady } from "./ready.js";

const item = (ready: Promise<void>, tag = "bang-x") => ({ selector: `${tag}#a`, tag, ready });
const later = (ms: number, fail?: string) =>
  new Promise<void>((resolve, reject) => setTimeout(() => (fail ? reject(new Error(fail)) : resolve()), ms));

describe("ready", () => {
  it("waits for slow items", async () => {
    const started = Date.now();
    const failed = await settleReady([item(later(50))], 1000);
    expect(failed).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(45);
  });

  it("collects rejections and still waits for the others", async () => {
    let done = false;
    const slow = later(60).then(() => {
      done = true;
    });
    const failed = await settleReady([item(later(1, "boom"), "bang-fail"), item(slow)], 1000);
    expect(failed).toEqual([{ selector: "bang-fail#a", tag: "bang-fail", reason: "boom" }]);
    expect(done).toBe(true);
  });

  it("reports timeouts", async () => {
    const failed = await settleReady([item(new Promise(() => undefined))], 30);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("timed out");
  });

  it("keeps the first line and at most 200 characters of the reason", async () => {
    const failed = await settleReady([item(later(1, `${"x".repeat(300)}\nsecond line`))], 1000);
    expect(failed[0].reason).toBe("x".repeat(200));
  });
});
