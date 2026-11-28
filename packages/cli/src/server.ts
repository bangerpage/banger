import { createReadStream, existsSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, normalize, resolve, sep } from "node:path";
import { CORE_PACKAGE, coreDistDir } from "./core-package.js";
import { CliError, readInput } from "./errors.js";
import type { PresenterStatus } from "./platform/status.js";
import { injectBeforeBodyEnd, rewriteRuntimeScript } from "./html-transform.js";

export interface DeckServer {
  url: string;
  urlFor(query?: string): string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

export function contentType(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Resolves a URL path under `root`; null when it escapes `root` or contains a NUL. */
export function resolveWithin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const base = resolve(root);
  const full = normalize(join(base, decoded));
  return full === base || full.startsWith(base + sep) ? full : null;
}

const RELOAD_SNIPPET = `<script>new EventSource("/__banger/events").addEventListener("reload",()=>location.reload())</script>`;
const EVENTS_PATH = "/__banger/events";
const STATUS_PATH = "/__banger/status";
const CORE_PREFIX = "/__banger/core/";

export async function startServer(opts: { file: string; watch: boolean; port?: number; status?: () => Promise<PresenterStatus> }): Promise<DeckServer> {
  readInput(opts.file);
  const file = resolve(opts.file);
  const root = dirname(file);
  const served = new Set<string>();
  const clients = new Set<ServerResponse>();
  let listenPort = 0;

  const send = (res: ServerResponse, status: number, body: string, type = "text/plain; charset=utf-8") => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };

  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
    const urlPath = (req.url ?? "/").split("?")[0] ?? "/";

    if (urlPath === EVENTS_PATH && opts.watch) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(": connected\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    if (urlPath === STATUS_PATH && opts.status) {
      // A page on another site can reach 127.0.0.1 (DNS rebinding); only our own host names may read the account.
      const host = (req.headers.host ?? "").toLowerCase();
      if (host !== `127.0.0.1:${listenPort}` && host !== `localhost:${listenPort}`) return send(res, 403, "forbidden");
      if (req.method === "HEAD") return send(res, 200, "", "application/json; charset=utf-8");
      opts.status().then(
        (status) => send(res, 200, JSON.stringify(status), "application/json; charset=utf-8"),
        () => send(res, 500, "status unavailable"),
      );
      return;
    }

    const isCore = urlPath.startsWith(CORE_PREFIX);
    const target = isCore
      ? resolveWithin(coreDistDir(), urlPath.slice(CORE_PREFIX.length))
      : resolveWithin(root, urlPath === "/" ? basename(file) : urlPath);
    if (!target || !existsSync(target) || !statSync(target).isFile()) return send(res, 404, "not found");

    if (!isCore) served.add(target);
    const type = contentType(target);
    if (!isCore && extname(target).toLowerCase() === ".html") {
      let html = rewriteRuntimeScript(readFileSync(target, "utf8"), CORE_PACKAGE, `${CORE_PREFIX}index.js`);
      if (opts.watch) html = injectBeforeBodyEnd(html, RELOAD_SNIPPET);
      return send(res, 200, req.method === "HEAD" ? "" : html, type);
    }
    res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
    if (req.method === "HEAD") return res.end();
    // The file can disappear between the stat above and the open; an unhandled stream error would end the preview.
    createReadStream(target)
      .on("error", () => res.destroy())
      .pipe(res);
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      rejectListen(
        error.code === "EADDRINUSE"
          ? new CliError(2, `port ${opts.port} is already in use`)
          : new CliError(2, `cannot start the server: ${error.message}`),
      );
    });
    server.listen(opts.port ?? 0, "127.0.0.1", resolveListen);
  });

  listenPort = (server.address() as AddressInfo).port;

  let watcher: FSWatcher | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (opts.watch) {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (!name || !served.has(join(root, name.toString()))) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const client of clients) client.write("event: reload\ndata: {}\n\n");
      }, 100);
    });
  }

  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const entry = `${origin}/${encodeURIComponent(basename(file))}`;
  return {
    url: entry,
    urlFor: (query) => (query ? `${entry}?${query}` : entry),
    close: async () => {
      clearTimeout(timer);
      watcher?.close();
      for (const client of clients) client.end();
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}
