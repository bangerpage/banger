import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../errors.js";
import { credentialsPath } from "../platform/client.js";
import { runLogin, runLogout } from "./account.js";
import { collectDeck, limitProblems, LIMITS, runPublish, slugFrom } from "./publish.js";

let root: string;
let deck: string;
const saved = { ...process.env };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "banger-publish-"));
  deck = join(root, "My Talk");
  mkdirSync(join(deck, "assets"), { recursive: true });
  writeFileSync(join(deck, "index.html"), "<bang-root></bang-root>");
  writeFileSync(join(deck, "assets", "a.png"), "png");
  writeFileSync(join(deck, "notes.md"), "not sent");
  mkdirSync(join(deck, "node_modules", "x"), { recursive: true });
  writeFileSync(join(deck, "node_modules", "x", "i.js"), "skip");
  writeFileSync(join(deck, ".env"), "SECRET=1");
  process.env = { ...saved, XDG_CONFIG_HOME: join(root, "config"), BANGER_HOST: "https://example.test" };
  delete process.env.BANGER_TOKEN;
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
  rmSync(root, { recursive: true, force: true });
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** A fake banger.page that stores nothing and answers the calls publish makes. */
function fakeSite(opts: { slugTaken?: boolean; meStatus?: number } = {}) {
  const calls: Call[] = [];
  let version = 0;
  const json = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : init?.body;
    calls.push({ method, url, body });
    const path = new URL(url).pathname;
    if (path === "/oauth/token") {
      const form = new URLSearchParams(String(init?.body));
      if (form.get("code") !== "c1" || !form.get("code_verifier") || form.get("client_id") !== "banger-cli") {
        return json(400, { error: "invalid_grant", error_description: "bad code" });
      }
      return json(200, { access_token: "bgr_oauth", token_type: "bearer", scope: "publish read" });
    }
    if (path === "/oauth/revoke") return new Response(null, { status: 200 });
    if (path === "/api/v1/me") return opts.meStatus ? json(opts.meStatus, { error: { code: "unauthorized", message: "bad token" } }) : json(200, { username: "sotarok" });
    if (path === "/api/v1/uploads") {
      const files = (body as { files: { path: string; sha256: string }[] }).files;
      return json(200, { upload_id: "u1", uploads: files.map((f) => ({ path: f.path, sha256: f.sha256, method: "PUT", url: `https://example.test/api/uploads/u1/${f.sha256}?t=x` })), already_stored: 0 });
    }
    if (path.startsWith("/api/uploads/")) return new Response(null, { status: 204 });
    if (path === "/api/v1/decks" && method === "POST") {
      if (opts.slugTaken) return json(409, { error: { code: "slug_taken", message: "my-talk is taken" } });
      version = 1;
      const slug = (body as { slug: string }).slug;
      return json(201, { url: `https://example.test/sotarok/${slug}`, slug, version });
    }
    if (path.startsWith("/api/v1/decks/") && method === "PUT") {
      version += 1;
      const slug = decodeURIComponent(path.split("/").pop()!);
      return json(200, { url: `https://example.test/sotarok/${slug}`, slug, version });
    }
    return json(404, { error: { code: "not_found", message: "no route" } });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("collectDeck", () => {
  it("sends index.html and accepted files, and leaves out dotfiles, node_modules and other kinds", () => {
    const { files, skipped } = collectDeck(deck);
    expect(files.map((f) => f.path)).toEqual(["assets/a.png", "index.html"]);
    expect(skipped).toEqual(["notes.md"]);
    expect(files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("needs an index.html", () => {
    rmSync(join(deck, "index.html"));
    expect(() => collectDeck(deck)).toThrow(CliError);
  });

  it("lists a symbolic link as not sent", () => {
    symlinkSync(join(deck, "assets", "a.png"), join(deck, "link.png"));
    const { files, skipped } = collectDeck(deck);
    expect(files.map((f) => f.path)).not.toContain("link.png");
    expect(skipped).toContain("link.png");
  });
});

describe("limits and slugs", () => {
  it("names each limit that is exceeded", () => {
    const big = { path: "index.html", sha256: "a", size: LIMITS.html + 1 };
    expect(limitProblems([big])).toEqual(["index.html is 2.0 MB; the limit is 2.0 MB"]);
    expect(limitProblems([{ ...big, size: 10 }])).toEqual([]);
  });

  it("makes a slug from a directory name", () => {
    expect(slugFrom("My Talk")).toBe("my-talk");
    expect(slugFrom("YAPC::Tokyo 2026!")).toBe("yapc-tokyo-2026");
    expect(slugFrom("日本語")).toBe("");
  });
});

describe("login and logout", () => {
  it("checks the token, stores it readable only by the user, and forgets it on logout", async () => {
    const site = fakeSite();
    expect(await runLogin(["--token", "bgr_x"], { fetchImpl: site.fetchImpl })).toBe(0);
    const file = credentialsPath();
    expect(JSON.parse(readFileSync(file, "utf8")).hosts["https://example.test"]).toEqual({ token: "bgr_x", username: "sotarok" });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await runLogout([], { fetchImpl: site.fetchImpl })).toBe(0);
    expect(() => statSync(file)).toThrow();
    expect(site.calls.at(-1)).toMatchObject({ method: "POST", url: "https://example.test/oauth/revoke" });
  });

  it("logout removes a credentials file that cannot be read", async () => {
    const file = credentialsPath();
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "{not json");
    expect(await runLogout([], { fetchImpl: fakeSite().fetchImpl })).toBe(0);
    expect(existsSync(file)).toBe(false);
  });

  it("logs in through the browser with PKCE and stores the token the site returns", async () => {
    const site = fakeSite();
    let authorize: URL | undefined;
    const open = (url: string) => {
      authorize = new URL(url);
      const back = new URL(authorize.searchParams.get("redirect_uri")!);
      back.search = new URLSearchParams({ code: "c1", state: authorize.searchParams.get("state")! }).toString();
      void fetch(back);
    };
    expect(await runLogin([], { fetchImpl: site.fetchImpl, open })).toBe(0);
    expect(authorize!.pathname).toBe("/authorize");
    expect(authorize!.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize!.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(JSON.parse(readFileSync(credentialsPath(), "utf8")).hosts["https://example.test"].token).toBe("bgr_oauth");
  });

  it("stops when the person does not allow the login in the browser", async () => {
    const open = (url: string) => {
      const authorize = new URL(url);
      const back = new URL(authorize.searchParams.get("redirect_uri")!);
      back.search = new URLSearchParams({ error: "access_denied", state: authorize.searchParams.get("state")! }).toString();
      void fetch(back);
    };
    await expect(runLogin([], { fetchImpl: fakeSite().fetchImpl, open })).rejects.toThrow(/not allowed/);
  });

  it("refuses a token the site does not accept, and stores nothing", async () => {
    await expect(runLogin(["--token", "bad"], { fetchImpl: fakeSite({ meStatus: 401 }).fetchImpl })).rejects.toMatchObject({ exitCode: 2 });
    expect(() => statSync(credentialsPath())).toThrow();
  });
});

describe("runPublish", () => {
  it("is a usage error without a token", async () => {
    await expect(runPublish([deck, "--skip-check"], fakeSite().fetchImpl)).rejects.toMatchObject({ exitCode: 2 });
  });

  it("publishes with a slug from the directory, then updates the same deck", async () => {
    process.env.BANGER_TOKEN = "bgr_env";
    const site = fakeSite();
    expect(await runPublish([deck, "--skip-check"], site.fetchImpl)).toBe(0);
    const upload = site.calls.find((c) => c.url.endsWith("/api/v1/uploads"))!;
    expect((upload.body as { files: unknown[] }).files).toHaveLength(2);
    expect(site.calls.filter((c) => c.url.includes("/api/uploads/u1/"))).toHaveLength(2);
    const created = site.calls.find((c) => c.method === "POST" && c.url.endsWith("/api/v1/decks"))!;
    expect(created.body).toMatchObject({ upload_id: "u1", slug: "my-talk", strict: false });
    const state = JSON.parse(readFileSync(join(deck, ".banger", "deck.json"), "utf8"));
    expect(state.decks["https://example.test"]).toEqual({ slug: "my-talk", url: "https://example.test/sotarok/my-talk" });

    expect(await runPublish([deck, "--skip-check"], site.fetchImpl)).toBe(0);
    expect(site.calls.at(-1)).toMatchObject({ method: "PUT", url: "https://example.test/api/v1/decks/my-talk" });
    expect(site.calls.some((c) => c.url.includes(".banger"))).toBe(false);
  });

  it("explains a taken slug", async () => {
    process.env.BANGER_TOKEN = "bgr_env";
    await expect(runPublish([deck, "--skip-check"], fakeSite({ slugTaken: true }).fetchImpl)).rejects.toThrow(/--slug/);
  });

  it("rejects a slug it would change and an unknown visibility", async () => {
    await expect(runPublish([deck, "--slug", "My Talk"], fakeSite().fetchImpl)).rejects.toMatchObject({ exitCode: 2 });
    await expect(runPublish([deck, "--visibility", "secret"], fakeSite().fetchImpl)).rejects.toMatchObject({ exitCode: 2 });
  });
});
