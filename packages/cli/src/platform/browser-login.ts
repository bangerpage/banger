import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { CliError } from "../errors.js";
import { CLIENT_ID } from "./client.js";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const base64url = (bytes: Buffer) => bytes.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

/** Opens `url` in the default browser. Failing to open it is not an error: the URL is also printed. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The printed URL is the fallback.
  }
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Banger</title><body style="font:20px system-ui;margin:64px">${message}</body>`;

/**
 * Runs the browser half of the login: listens on 127.0.0.1, sends the person to the site's /authorize, and resolves
 * with the authorization code that comes back to /callback.
 */
export async function authorizeInBrowser(
  host: string,
  opts: { open?: (url: string) => void; timeoutMs?: number } = {},
): Promise<{ code: string; verifier: string; redirectUri: string }> {
  const { verifier, challenge } = pkcePair();
  const state = base64url(randomBytes(16));
  let settle: { resolve: (code: string) => void; reject: (error: Error) => void } | undefined;
  const result = new Promise<string>((resolve, reject) => (settle = { resolve, reject }));

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      res.writeHead(404).end();
      return;
    }
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(PAGE("This login link does not match the one the CLI started. Run banger login again."));
      return;
    }
    if (error || !code) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE("The login was not allowed. You can close this tab."));
      settle?.reject(new CliError(2, error === "access_denied" ? "the login was not allowed in the browser" : `the login failed: ${error ?? "no code"}`));
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(PAGE("Logged in to Banger. You can close this tab and go back to the terminal."));
    settle?.resolve(code);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  const authorize = new URL(`${host}/authorize`);
  authorize.search = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "publish read",
  }).toString();

  process.stdout.write(`opening ${authorize.href}\nif the browser does not open, open that URL yourself\n`);
  (opts.open ?? openInBrowser)(authorize.href);
  const timer = setTimeout(
    () => settle?.reject(new CliError(2, "no answer from the browser within 5 minutes; run banger login again")),
    opts.timeoutMs ?? LOGIN_TIMEOUT_MS,
  );
  try {
    const code = await result;
    return { code, verifier, redirectUri };
  } finally {
    clearTimeout(timer);
    server.closeAllConnections();
    server.close();
  }
}
