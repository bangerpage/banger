import type { Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { BrowserNotFoundError, installHint, launchBrowser } from "./browser.js";

const fake = { name: "fake" } as unknown as Browser;
const fail = () => Promise.reject(new Error("no browser"));

describe("browser", () => {
  it("throws BrowserNotFoundError when both launchers fail", async () => {
    await expect(launchBrowser({ launchers: { chrome: fail, chromium: fail } })).rejects.toBeInstanceOf(BrowserNotFoundError);
  });

  it("falls back to chromium when chrome fails", async () => {
    await expect(launchBrowser({ launchers: { chrome: fail, chromium: () => Promise.resolve(fake) } })).resolves.toBe(fake);
  });

  it("prefers chrome", async () => {
    const chrome = { name: "chrome" } as unknown as Browser;
    await expect(launchBrowser({ launchers: { chrome: () => Promise.resolve(chrome), chromium: fail } })).resolves.toBe(chrome);
  });

  it("installHint names the playwright-core install command", () => {
    expect(installHint()).toMatch(/npx playwright-core@\d+\.\d+\.\d+\S* install chromium/);
  });
});
