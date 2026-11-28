import type { Browser } from "playwright-core";
import { describe, expect, it } from "vitest";
import { BrowserNotFoundError, BrowserSandboxError, installHint, launchBrowser, sandboxEnabled } from "./browser.js";

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

  it("launches with the sandbox on unless told otherwise", async () => {
    const seen: boolean[] = [];
    const record = (sandbox: boolean) => (seen.push(sandbox), Promise.resolve(fake));
    await launchBrowser({ launchers: { chrome: record, chromium: fail } });
    await launchBrowser({ sandbox: false, warn: () => {}, launchers: { chrome: record, chromium: fail } });
    expect(seen).toEqual([true, false]);
  });

  it("warns when the sandbox is off", async () => {
    const warnings: string[] = [];
    await launchBrowser({ sandbox: false, warn: (m) => warnings.push(m), launchers: { chrome: () => Promise.resolve(fake), chromium: fail } });
    expect(warnings).toEqual([expect.stringContaining("BANGER_NO_SANDBOX=1")]);
  });

  it("reports a sandbox failure apart from a missing browser", async () => {
    const noSandbox = () => Promise.reject(new Error("No usable sandbox! Update your kernel"));
    await expect(launchBrowser({ launchers: { chrome: fail, chromium: noSandbox } })).rejects.toBeInstanceOf(BrowserSandboxError);
  });

  it("BANGER_NO_SANDBOX=1 alone turns the sandbox off", () => {
    expect(sandboxEnabled({})).toBe(true);
    expect(sandboxEnabled({ BANGER_NO_SANDBOX: "0" })).toBe(true);
    expect(sandboxEnabled({ BANGER_NO_SANDBOX: "1" })).toBe(false);
  });

  it("installHint names the playwright-core install command", () => {
    expect(installHint()).toMatch(/npx playwright-core@\d+\.\d+\.\d+\S* install chromium/);
  });
});
