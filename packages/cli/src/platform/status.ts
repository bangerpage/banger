import { basename, dirname, resolve } from "node:path";
import { readState } from "../commands/publish.js";
import { ApiError, PlatformClient, platformHost, tokenFor, type DeckInfo, type Me } from "./client.js";

export type AccountStatus =
  | { state: "logged_in"; username: string; displayName?: string; avatarUrl?: string }
  | { state: "logged_out" | "invalid" | "unavailable" };
export type DeckStatus =
  | { state: "none" }
  | { state: "published"; visibility: "public" | "unlisted"; version?: number; url?: string }
  | { state: "unpublished" | "missing" | "unverified"; url?: string };
export interface PresenterStatus {
  account: AccountStatus;
  deck: DeckStatus;
}

export interface StatusProviderOptions {
  file: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

export const STATUS_TTL_MS = 30_000;
export const STATUS_TIMEOUT_MS = 3_000;

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const webUrl = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

const nonEmpty = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const positiveInt = (value: unknown): number | undefined => (typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined);

function avatarOf(value: unknown, host: string): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === new URL(host).origin ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function accountOf(me: PromiseSettledResult<Me>, host: string): AccountStatus {
  if (me.status === "fulfilled") {
    const username = nonEmpty(me.value?.username);
    if (!username) return { state: "unavailable" };
    const displayName = nonEmpty(me.value.display_name);
    const avatarUrl = avatarOf(me.value.avatar_url, host);
    return { state: "logged_in", username, ...(displayName ? { displayName } : {}), ...(avatarUrl ? { avatarUrl } : {}) };
  }
  return me.reason instanceof ApiError && me.reason.status === 401 ? { state: "invalid" } : { state: "unavailable" };
}

const unverifiedDeck = (url?: string): DeckStatus => ({ state: "unverified", ...(url ? { url } : {}) });

function deckOf(info: PromiseSettledResult<DeckInfo | null>, record: { slug: string; url?: string } | null): DeckStatus {
  if (!record) return { state: "none" };
  const recordUrl = record.url;
  const unverified = unverifiedDeck(recordUrl);
  if (info.status === "rejected") {
    const error = info.reason;
    return error instanceof ApiError && error.status === 404 && error.code === "not_found"
      ? { state: "missing", ...(recordUrl ? { url: recordUrl } : {}) }
      : unverified;
  }
  const deck = info.value;
  if (!deck || typeof deck !== "object") return unverified;
  const url = webUrl(deck.url) ?? recordUrl;
  if (deck.status === "unpublished") return { state: "unpublished", ...(url ? { url } : {}) };
  if (deck.status === "published" && (deck.visibility === "public" || deck.visibility === "unlisted")) {
    const version = positiveInt(deck.current_version) ?? positiveInt(deck.version);
    return { state: "published", visibility: deck.visibility, ...(version ? { version } : {}), ...(url ? { url } : {}) };
  }
  return unverified;
}

/** Builds the account and publish status shown in the presenter window. The returned function never rejects. */
export function createStatusProvider(opts: StatusProviderOptions): () => Promise<PresenterStatus> {
  const env = opts.env ?? process.env;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const timeoutMs = opts.timeoutMs ?? STATUS_TIMEOUT_MS;
  let cache: { at: number; value: Promise<PresenterStatus> } | undefined;

  const readRecord = (host: string): { slug: string; url?: string } | null => {
    if (basename(opts.file) !== "index.html") return null;
    try {
      const entry = readState(dirname(resolve(opts.file))).decks[host];
      if (!entry || typeof entry.slug !== "string" || !SLUG.test(entry.slug)) return null;
      const url = webUrl(entry.url);
      return { slug: entry.slug, ...(url ? { url } : {}) };
    } catch {
      return null;
    }
  };

  const collect = async (): Promise<PresenterStatus> => {
    try {
      const host = platformHost(env);
      const record = readRecord(host);
      let token: string | null;
      try {
        token = tokenFor(host, env);
      } catch {
        token = null;
      }
      const recordDeck = (): DeckStatus => (record ? unverifiedDeck(record.url) : { state: "none" });
      if (token === null) return { account: { state: "logged_out" }, deck: recordDeck() };

      const timed: typeof fetch = (input, init) => fetchImpl(input, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      const client = new PlatformClient(host, token, timed);
      const [me, info] = await Promise.allSettled([client.me(), record ? client.deck(record.slug) : Promise.resolve(null)]);
      const account = accountOf(me, host);
      return { account, deck: account.state === "logged_in" ? deckOf(info, record) : recordDeck() };
    } catch {
      return { account: { state: "unavailable" }, deck: { state: "none" } };
    }
  };

  return () => {
    if (cache && now() - cache.at < STATUS_TTL_MS) return cache.value;
    const value = collect();
    cache = { at: now(), value };
    return value;
  };
}
