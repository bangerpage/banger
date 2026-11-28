import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveToken } from "./client.js";
import { createStatusProvider, STATUS_TTL_MS, type PresenterStatus } from "./status.js";

const HOST = "https://example.test";
let root: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "banger-status-"));
  env = { XDG_CONFIG_HOME: join(root, "config"), BANGER_HOST: HOST };
  mkdirSync(join(root, "deck"), { recursive: true });
  writeFileSync(join(root, "deck", "index.html"), "<bang-root></bang-root>");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const login = () => saveToken(HOST, "bgr_secret_token", "alice", env);
const record = (value: unknown) => {
  mkdirSync(join(root, "deck", ".banger"), { recursive: true });
  writeFileSync(join(root, "deck", ".banger", "deck.json"), typeof value === "string" ? value : JSON.stringify({ decks: { [HOST]: value } }));
};
const index = () => join(root, "deck", "index.html");

interface SiteOpts {
  me?: () => Response | Promise<Response>;
  deck?: () => Response | Promise<Response>;
}
function fakeSite(opts: SiteOpts = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    calls.push(path);
    if (path === "/api/v1/me") return opts.me ? opts.me() : json(200, { username: "alice", display_name: "Alice", avatar_url: `${HOST}/avatars/a.png` });
    if (path.startsWith("/api/v1/decks/"))
      return opts.deck
        ? opts.deck()
        : json(200, { slug: "my-talk", url: `${HOST}/alice/my-talk`, visibility: "unlisted", status: "published", version: 5, current_version: 3 });
    return json(404, { error: { code: "not_found", message: "no route" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}
const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const provider = (site: { fetchImpl: typeof fetch }, extra: Record<string, unknown> = {}) =>
  createStatusProvider({ file: index(), env, fetchImpl: site.fetchImpl, ...extra });
const goodRecord = { slug: "my-talk", url: `${HOST}/alice/my-talk` };

describe("createStatusProvider", () => {
  it("returns the account and keeps avatar_url only when it is https on the platform origin", async () => {
    login();
    const status = await provider(fakeSite())();
    expect(status.account).toEqual({ state: "logged_in", username: "alice", displayName: "Alice", avatarUrl: `${HOST}/avatars/a.png` });
    for (const avatar of ["http://example.test/a.png", "https://evil.test/a.png", null, 5]) {
      const site = fakeSite({ me: () => json(200, { username: "alice", avatar_url: avatar }) });
      expect(await provider(site)()).toMatchObject({ account: { state: "logged_in", username: "alice" } });
      expect(((await provider(site)()).account as { avatarUrl?: string }).avatarUrl).toBeUndefined();
    }
  });

  it("maps a published deck, preferring current_version", async () => {
    login();
    record(goodRecord);
    expect((await provider(fakeSite())()).deck).toEqual({ state: "published", visibility: "unlisted", version: 3, url: `${HOST}/alice/my-talk` });
    const site = fakeSite({ deck: () => json(200, { url: `${HOST}/alice/my-talk`, visibility: "public", status: "published", version: 4, current_version: null }) });
    expect((await provider(site)()).deck).toMatchObject({ state: "published", visibility: "public", version: 4 });
  });

  it("falls back to the recorded url when the response url is not http(s)", async () => {
    login();
    record(goodRecord);
    const site = fakeSite({ deck: () => json(200, { url: "javascript:alert(1)", visibility: "public", status: "published" }) });
    expect((await provider(site)()).deck).toEqual({ state: "published", visibility: "public", url: goodRecord.url });
  });

  it("maps unpublished, unknown shapes, and missing decks", async () => {
    login();
    record(goodRecord);
    const of = async (deck: SiteOpts["deck"]) => (await provider(fakeSite({ deck }))()).deck;
    expect(await of(() => json(200, { status: "unpublished", visibility: "public" }))).toEqual({ state: "unpublished", url: goodRecord.url });
    expect(await of(() => json(200, { status: "published", visibility: "team" }))).toEqual({ state: "unverified", url: goodRecord.url });
    expect(await of(() => json(200, { visibility: "public" }))).toEqual({ state: "unverified", url: goodRecord.url });
    expect(await of(() => json(404, { error: { code: "not_found", message: "x" } }))).toEqual({ state: "missing", url: goodRecord.url });
    expect(await of(() => json(404, { error: { code: "other", message: "x" } }))).toEqual({ state: "unverified", url: goodRecord.url });
  });

  it("reports logged_out without calling the API, and unverified when a record exists", async () => {
    const site = fakeSite();
    expect(await provider(site)()).toEqual({ account: { state: "logged_out" }, deck: { state: "none" } });
    record(goodRecord);
    expect(await provider(site)()).toEqual({ account: { state: "logged_out" }, deck: { state: "unverified", url: goodRecord.url } });
    expect(site.calls).toEqual([]);
  });

  it("keeps invalid, unavailable and timeout apart and never publishes under a failed account", async () => {
    login();
    record(goodRecord);
    const hang = () => new Promise<Response>(() => {});
    const cases: [SiteOpts["me"], string][] = [
      [() => json(401, { error: { code: "unauthorized", message: "bad" } }), "invalid"],
      [() => json(500, { error: { code: "boom", message: "bad" } }), "unavailable"],
      [() => Promise.reject(new Error("offline")), "unavailable"],
      [hang, "unavailable"],
    ];
    for (const [me, state] of cases) {
      const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
        const path = new URL(String(input)).pathname;
        if (path === "/api/v1/me") {
          if (me === hang) return new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
          return me!();
        }
        return json(200, { url: goodRecord.url, visibility: "public", status: "published", version: 1 });
      }) as typeof fetch;
      const status = await createStatusProvider({ file: index(), env, fetchImpl, timeoutMs: 20 })();
      expect(status.account.state).toBe(state);
      expect(status.deck).toEqual({ state: "unverified", url: goodRecord.url });
    }
  });

  it("does not reject on a broken credentials file", async () => {
    mkdirSync(join(root, "config", "banger"), { recursive: true });
    writeFileSync(join(root, "config", "banger", "credentials.json"), "{nope");
    expect((await provider(fakeSite())()).account.state).toBe("logged_out");
  });

  it("has no deck status without a usable record or for a file other than index.html", async () => {
    login();
    const site = fakeSite();
    expect((await provider(site)()).deck).toEqual({ state: "none" });
    record("{broken");
    expect((await provider(site)()).deck).toEqual({ state: "none" });
    for (const slug of ["..", ".", "../x", "a/b", "My Talk", ""]) {
      record({ slug, url: goodRecord.url });
      expect((await provider(site)()).deck).toEqual({ state: "none" });
    }
    record(goodRecord);
    writeFileSync(join(root, "deck", "other.html"), "x");
    expect((await createStatusProvider({ file: join(root, "deck", "other.html"), env, fetchImpl: site.fetchImpl })()).deck).toEqual({ state: "none" });
    expect(site.calls.filter((p) => p.startsWith("/api/v1/decks/"))).toEqual([]);
  });

  it("calls decks for slugs the platform may choose", async () => {
    login();
    for (const slug of ["My_Talk.v2", "a".repeat(70)]) {
      record({ slug, url: goodRecord.url });
      const site = fakeSite();
      await provider(site)();
      expect(site.calls).toContain(`/api/v1/decks/${slug}`);
    }
  });

  it("keeps secrets out of the result", async () => {
    login();
    record(goodRecord);
    const site = fakeSite({
      me: () => json(500, { error: { code: "boom", message: "leak-me-please bgr_secret_token" } }),
      deck: () => json(500, { error: { code: "boom", message: "leak-me-please" } }),
    });
    const text = JSON.stringify(await provider(site)());
    expect(text).not.toContain("leak-me-please");
    expect(text).not.toContain("bgr_secret_token");
    expect(text.toLowerCase()).not.toContain("authorization");
  });

  it("asks upstream once per TTL, and once for concurrent calls", async () => {
    login();
    record(goodRecord);
    let t = 1000;
    const site = fakeSite();
    const get = provider(site, { now: () => t });
    const [a, b]: PresenterStatus[] = await Promise.all([get(), get()]);
    expect(a).toBe(b);
    await get();
    expect(site.calls).toHaveLength(2);
    t += STATUS_TTL_MS;
    await get();
    expect(site.calls).toHaveLength(4);
  });
});
