import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "../errors.js";

export const DEFAULT_HOST = "https://banger.page";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The banger.page origin to talk to: `BANGER_HOST` (for staging and tests) or banger.page. It must be an https URL, or
 * http on this machine, since the token goes with every request; anything else is `CliError(2)`.
 */
export function platformHost(env: NodeJS.ProcessEnv = process.env): string {
  const host = (env.BANGER_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    throw new CliError(2, `BANGER_HOST is not a URL: ${host}`);
  }
  const secure = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
  if (!secure) throw new CliError(2, `BANGER_HOST must be an https URL (http only for this machine): ${host}`);
  return host;
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim() || join(homedir(), ".config");
  return join(base, "banger", "credentials.json");
}

interface Credentials {
  hosts: Record<string, { token: string; username?: string }>;
}

function readCredentials(env: NodeJS.ProcessEnv): Credentials {
  const file = credentialsPath(env);
  if (!existsSync(file)) return { hosts: {} };
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Credentials>;
    return { hosts: data.hosts && typeof data.hosts === "object" ? data.hosts : {} };
  } catch {
    throw new CredentialsUnreadableError(file);
  }
}

export class CredentialsUnreadableError extends CliError {
  constructor(readonly file: string) {
    super(2, `${file} could not be read; run banger logout to remove it, then log in again`);
    this.name = "CredentialsUnreadableError";
  }
}

/** Deletes the credentials file, for `banger logout` when it cannot be read. */
export function removeCredentials(env: NodeJS.ProcessEnv = process.env): void {
  rmSync(credentialsPath(env), { force: true });
}

function writeCredentials(credentials: Credentials, env: NodeJS.ProcessEnv): void {
  const file = credentialsPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  // Written next to the file and renamed over it, so a crash mid-write cannot leave half a file.
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, file);
}

export function saveToken(host: string, token: string, username: string | undefined, env: NodeJS.ProcessEnv = process.env): void {
  const credentials = readCredentials(env);
  credentials.hosts[host] = { token, ...(username ? { username } : {}) };
  writeCredentials(credentials, env);
}

/** Forgets the token for `host`. Returns whether one was stored. */
export function forgetToken(host: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const credentials = readCredentials(env);
  if (!credentials.hosts[host]) return false;
  delete credentials.hosts[host];
  if (Object.keys(credentials.hosts).length === 0) rmSync(credentialsPath(env), { force: true });
  else writeCredentials(credentials, env);
  return true;
}

/** `BANGER_TOKEN` (for CI) wins over the token stored by `banger login`. */
export function tokenFor(host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.BANGER_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  return readCredentials(env).hosts[host]?.token ?? null;
}

export const CLIENT_ID = "banger-cli";

/** Trades an authorization code from the browser for a token (OAuth with PKCE; banger-cli is a public client). */
export async function exchangeCode(
  host: string,
  params: { code: string; verifier: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    code_verifier: params.verifier,
    redirect_uri: params.redirectUri,
    client_id: CLIENT_ID,
  });
  const response = await reach(host, () => fetchImpl(`${host}/oauth/token`, { method: "POST", body, signal: AbortSignal.timeout(API_TIMEOUT_MS) }));
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new ApiError(response.status, data.error ?? `http_${response.status}`, data.error_description ?? data.error ?? "the token request failed");
  }
  return data.access_token;
}

/** Revokes a token on the site. The site answers 200 whether or not it knew the token. */
export async function revokeToken(host: string, token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await reach(host, () =>
    fetchImpl(`${host}/oauth/revoke`, {
      method: "POST",
      body: new URLSearchParams({ token, client_id: CLIENT_ID }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    }),
  );
  if (!response.ok) throw new ApiError(response.status, `http_${response.status}`, `${response.status} ${response.statusText}`.trim());
}

/** The token stored for `host` by `banger login`, ignoring `BANGER_TOKEN`. */
export function storedToken(host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return readCredentials(env).hosts[host]?.token ?? null;
}

/** Every stored token, for every host (banger feedback looks for all of them in a draft). */
export function allStoredTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.values(readCredentials(env).hosts)
    .map((entry) => (typeof entry?.token === "string" ? entry.token.trim() : ""))
    .filter((token) => token !== "");
}

/** The banger.page username stored for `host` by `banger login`, ignoring `BANGER_TOKEN`. */
export function storedUsername(host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return readCredentials(env).hosts[host]?.username ?? null;
}

/** A dead network would otherwise leave publish, login and the presenter status waiting forever. */
const API_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface UploadFile {
  path: string;
  sha256: string;
  size: number;
}

export interface UploadPlan {
  upload_id: string;
  expires_at?: string;
  /** Only the files banger.page does not have yet; each is sent to its `url`. */
  uploads: { path: string; sha256: string; method?: string; url: string }[];
}

export interface DeckResult {
  url: string;
  slug: string;
  version?: number;
  runtime_version?: string;
  direct_url?: string;
}

export interface Me {
  username: string;
  display_name?: string;
  plan?: string;
  avatar_url?: string | null;
}

export interface DeckInfo {
  slug: string;
  url: string;
  visibility: string;
  status: string;
  version?: number;
  current_version?: number | null;
}

/** The banger.page HTTP API (`/api/v1`). Its shape is defined by the platform; this is only the caller. */
export class PlatformClient {
  constructor(
    readonly host: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  me(): Promise<Me> {
    return this.call<Me>("GET", "/api/v1/me");
  }

  deck(slug: string): Promise<DeckInfo> {
    return this.call<DeckInfo>("GET", `/api/v1/decks/${encodeURIComponent(slug)}`);
  }

  beginUpload(files: UploadFile[]): Promise<UploadPlan> {
    return this.call<UploadPlan>("POST", "/api/v1/uploads", { files });
  }

  async putBlob(url: string, body: Uint8Array, method = "PUT"): Promise<void> {
    // A large file gets longer than an API call: at least 50 KB/s on top of the usual limit.
    const timeoutMs = API_TIMEOUT_MS + Math.ceil(body.byteLength / 50_000) * 1000;
    const response = await reach(new URL(url).host, () =>
      this.fetchImpl(url, { method, body: body as BodyInit, signal: AbortSignal.timeout(timeoutMs) }),
    );
    if (!response.ok) throw await apiError(response);
  }

  publish(body: { upload_id: string; slug?: string; title?: string; visibility?: string; strict?: boolean; idempotency_key: string }): Promise<DeckResult> {
    return this.call<DeckResult>("POST", "/api/v1/decks", body);
  }

  update(slug: string, body: { upload_id: string; title?: string; visibility?: string; strict?: boolean; idempotency_key: string }): Promise<DeckResult> {
    return this.call<DeckResult>("PUT", `/api/v1/decks/${encodeURIComponent(slug)}`, body);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.host}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error) {
      throw new ApiError(0, "network", `could not reach ${this.host}: ${(error as Error).message}`);
    }
    if (!response.ok) throw await apiError(response);
    try {
      return (await response.json()) as T;
    } catch (error) {
      throw new ApiError(response.status, "invalid_response", `${this.host} sent a response that is not JSON: ${(error as Error).message}`);
    }
  }
}

/** Runs a request, turning a network failure or a timeout into `ApiError(0, "network")`. */
async function reach(host: string, request: () => Promise<Response>): Promise<Response> {
  try {
    return await request();
  } catch (error) {
    throw new ApiError(0, "network", `could not reach ${host}: ${(error as Error).message}`);
  }
}

async function apiError(response: Response): Promise<ApiError> {
  let code = `http_${response.status}`;
  let message = `${response.status} ${response.statusText}`.trim();
  try {
    const data = (await response.json()) as { error?: { code?: string; message?: string } };
    if (data.error?.code) code = data.error.code;
    if (data.error?.message) message = data.error.message;
  } catch {
    // Not JSON: keep the status line.
  }
  return new ApiError(response.status, code, message);
}
