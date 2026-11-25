import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError } from "../errors.js";

export const DEFAULT_HOST = "https://banger.page";

/** The banger.page origin to talk to: `BANGER_HOST` (for staging and tests) or banger.page. */
export function platformHost(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BANGER_HOST?.trim() || DEFAULT_HOST).replace(/\/+$/, "");
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
    throw new CliError(2, `${file} could not be read; run banger logout and log in again`);
  }
}

function writeCredentials(credentials: Credentials, env: NodeJS.ProcessEnv): void {
  const file = credentialsPath(env);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  // writeFileSync keeps the mode of a file that already exists.
  chmodSync(file, 0o600);
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

  beginUpload(files: UploadFile[]): Promise<UploadPlan> {
    return this.call<UploadPlan>("POST", "/api/v1/uploads", { files });
  }

  async putBlob(url: string, body: Uint8Array, method = "PUT"): Promise<void> {
    const response = await this.fetchImpl(url, { method, body: body as BodyInit });
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
      });
    } catch (error) {
      throw new ApiError(0, "network", `could not reach ${this.host}: ${(error as Error).message}`);
    }
    if (!response.ok) throw await apiError(response);
    return (await response.json()) as T;
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
