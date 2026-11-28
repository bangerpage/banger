import { request } from "node:http";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CORE_PACKAGE } from "./core-package.js";
import { CliError } from "./errors.js";
import type { PresenterStatus } from "./platform/status.js";
import { hostAllowed, resolveWithin, startServer, type DeckServer } from "./server.js";

const CDN = `https://cdn.jsdelivr.net/npm/${CORE_PACKAGE}@0.1.0/dist/index.js`;
const deck = `<html><body>\n<script type="module" src="${CDN}"></script>\n<p>hi</p>\n</body></html>\n`;

let dir = "";
let server: DeckServer | undefined;
let server2: DeckServer | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "banger-server-"));
  await writeFile(join(dir, "deck.html"), deck);
  await writeFile(join(dir, "asset.txt"), "asset");
});
afterEach(async () => {
  await server?.close();
  await server2?.close();
  server = server2 = undefined;
  await rm(dir, { recursive: true, force: true });
});

/** Subscribes to the SSE stream and resolves a promise per received event name. */
async function subscribe(url: string) {
  const controller = new AbortController();
  const res = await fetch(`${url}/__banger/events`, { signal: controller.signal });
  const events: string[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        for (const match of decoder.decode(chunk).matchAll(/^event: (\w+)/gm)) events.push(match[1] as string);
      }
    } catch {
      // aborted
    }
  })();
  return { events, stop: () => controller.abort() };
}

const origin = (s: DeckServer) => new URL(s.url).origin;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("server", () => {
  it("serves the deck with the runtime URL replaced and a reload script", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: true, port: 0 });
    const html = await (await fetch(server.url)).text();
    expect(html).toContain('src="/__banger/core/index.js"');
    expect(html).not.toContain(CDN);
    expect(html).toContain("EventSource");
    expect(await (await fetch(`${origin(server)}/asset.txt`)).text()).toBe("asset");
  });

  it("serves the local core under /__banger/core/", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
    const res = await fetch(`${origin(server)}/__banger/core/index.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
  });

  it("sends reload when the deck changes", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: true, port: 0 });
    await sleep(500);
    await fetch(server.url);
    const sub = await subscribe(origin(server));
    await sleep(200);
    await writeFile(join(dir, "deck.html"), `${deck}<!-- changed -->`);
    await sleep(800);
    sub.stop();
    expect(sub.events).toContain("reload");
  });

  it("does not reload for files it never served", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: true, port: 0 });
    // FSEvents can replay the writes from beforeEach right after the watcher starts.
    await sleep(500);
    await fetch(server.url);
    await fetch(`${origin(server)}/asset.txt`);
    const sub = await subscribe(origin(server));
    await sleep(200);
    await mkdir(join(dir, "snap"));
    await writeFile(join(dir, "snap", "stop-000-step-000.png"), "png");
    await writeFile(join(dir, "deck.pdf"), "pdf");
    await writeFile(join(dir, ".DS_Store"), "x");
    await sleep(600);
    expect(sub.events).toEqual([]);
    await writeFile(join(dir, "asset.txt"), "changed asset");
    await sleep(600);
    sub.stop();
    expect(sub.events).toContain("reload");
  });

  it("watch false has no events endpoint and injects no EventSource", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
    expect((await fetch(`${origin(server)}/__banger/events`)).status).toBe(404);
    expect(await (await fetch(server.url)).text()).not.toContain("EventSource");
  });

  it("returns 404 outside the root and 405 for POST", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
    const base = origin(server);
    for (const path of ["/..%2f..%2fetc/passwd", "/../x", "/%00", "/missing.html", "/__banger/core/..%2fpackage.json"]) {
      expect((await fetch(base + path)).status, path).toBe(404);
    }
    expect((await fetch(base, { method: "POST" })).status).toBe(405);
  });

  it("does not follow a symbolic link out of the deck's folder", async () => {
    const outside = await mkdtemp(join(tmpdir(), "banger-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(join(outside, "secret.txt"), join(dir, "leak.txt"));
      await symlink(outside, join(dir, "out"));
      await symlink(join(dir, "asset.txt"), join(dir, "inside.txt"));
      server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
      const base = origin(server);
      expect((await fetch(`${base}/leak.txt`)).status).toBe(404);
      expect((await fetch(`${base}/out/secret.txt`)).status).toBe(404);
      const inside = await fetch(`${base}/inside.txt`);
      expect(inside.status).toBe(200);
      expect(await inside.text()).toBe("asset");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("reports a port in use as CliError(2)", async () => {
    server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
    const port = Number(new URL(server.url).port);
    const error = await startServer({ file: join(dir, "deck.html"), watch: false, port }).catch((e) => e);
    expect(error).toBeInstanceOf(CliError);
    expect(error.exitCode).toBe(2);
  });

  it("resolveWithin rejects escapes and NUL", () => {
    expect(resolveWithin("/root", "/a/b.png")).toBe("/root/a/b.png");
    expect(resolveWithin("/root", "/../x")).toBeNull();
    expect(resolveWithin("/root", "/..%2fx")).toBeNull();
    expect(resolveWithin("/root", "/a%00b")).toBeNull();
    expect(resolveWithin("/root", "/%E0%A4%A")).toBeNull();
  });

  describe("host names", () => {
    const get = (port: number, path: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path, headers: { host } }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode ?? 0));
        });
        req.on("error", reject);
        req.end();
      });

    it("answers only to its own names and the ones allowed, on every path", async () => {
      server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0, allowHosts: ["mac.tail1234.ts.net"] });
      const port = Number(new URL(server.url).port);
      for (const path of ["/", "/asset.txt", "/__banger/core/index.js"]) {
        expect(await get(port, path, `127.0.0.1:${port}`), path).toBe(200);
        expect(await get(port, path, `localhost:${port}`), path).toBe(200);
        expect(await get(port, path, "mac.tail1234.ts.net"), path).toBe(200);
        expect(await get(port, path, "Mac.Tail1234.ts.net:4443"), path).toBe(200);
        expect(await get(port, path, `evil.test:${port}`), path).toBe(403);
        expect(await get(port, path, `127.0.0.1:${port + 1}`), path).toBe(403);
      }
    });

    it("hostAllowed", () => {
      expect(hostAllowed("127.0.0.1:80", 80)).toBe(true);
      expect(hostAllowed("[::1]:80", 80)).toBe(true);
      expect(hostAllowed("localhost", 80)).toBe(false);
      expect(hostAllowed(undefined, 80)).toBe(false);
      expect(hostAllowed("a.ts.net", 80, ["a.ts.net"])).toBe(true);
      expect(hostAllowed("b.a.ts.net", 80, ["a.ts.net"])).toBe(false);
    });
  });

  it("does not serve dotfiles or node_modules from the deck's folder", async () => {
    await mkdir(join(dir, ".banger"));
    await writeFile(join(dir, ".banger", "deck.json"), "{}");
    await writeFile(join(dir, ".env"), "SECRET=1");
    await mkdir(join(dir, "node_modules"));
    await writeFile(join(dir, "node_modules", "x.js"), "");
    server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
    const base = origin(server);
    for (const path of ["/.banger/deck.json", "/.env", "/node_modules/x.js", "/%2eenv"]) {
      expect((await fetch(base + path)).status, path).toBe(404);
    }
  });

  describe("/__banger/status", () => {
    const status: PresenterStatus = { account: { state: "logged_in", username: "alice" }, deck: { state: "none" } };
    const get = (port: number, host: string | undefined, method = "GET") =>
      new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port, path: "/__banger/status", method, headers: host === undefined ? {} : { host } }, (res) => {
          let body = "";
          res.on("data", (c) => (body += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on("error", reject);
        req.end();
      });

    it("answers on the server's own host names only, without CORS headers", async () => {
      let calls = 0;
      server = await startServer({
        file: join(dir, "deck.html"),
        watch: false,
        port: 0,
        status: async () => {
          calls += 1;
          return status;
        },
      });
      const port = Number(new URL(server.url).port);
      for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
        const res = await get(port, host);
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body)).toEqual(status);
        expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
        expect(res.headers["access-control-allow-origin"]).toBeUndefined();
      }
      expect((await get(port, "evil.test")).status).toBe(403);
      server2 = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0, allowHosts: ["mac.ts.net"], status: async () => status });
      const port2 = Number(new URL(server2.url).port);
      expect((await get(port2, "mac.ts.net")).status).toBe(403);
      expect((await get(port, `127.0.0.1:${port + 1}`)).status).toBe(403);
      expect(calls).toBe(2);
      expect((await get(port, `127.0.0.1:${port}`, "POST")).status).toBe(405);
      const head = await get(port, `127.0.0.1:${port}`, "HEAD");
      expect(head.status).toBe(200);
      expect(calls).toBe(2);
    });

    it("answers 500 with a fixed message when the provider throws", async () => {
      server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0, status: () => Promise.reject(new Error("secret")) });
      const port = Number(new URL(server.url).port);
      const res = await get(port, `127.0.0.1:${port}`);
      expect(res.status).toBe(500);
      expect(res.body).toBe("status unavailable");
    });

    it("is a 404 without a status option", async () => {
      server = await startServer({ file: join(dir, "deck.html"), watch: false, port: 0 });
      expect((await fetch(`${origin(server)}/__banger/status`)).status).toBe(404);
    });
  });
});
