export type PresenterAccount =
  | { state: "logged_in"; username: string; displayName?: string; avatarUrl?: string }
  | { state: "logged_out" | "invalid" | "unavailable" };
export type PresenterDeck =
  | { state: "none" }
  | { state: "published"; visibility: "public" | "unlisted"; version?: number; url?: string }
  | { state: "unpublished" | "missing" | "unverified"; url?: string };
export interface PresenterStatus {
  account: PresenterAccount;
  deck: PresenterDeck;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function urlWith(value: unknown, protocols: string[]): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    return protocols.includes(new URL(value).protocol) ? value : undefined;
  } catch {
    return undefined;
  }
}

function parseAccount(data: unknown): PresenterAccount | null {
  if (!isRecord(data)) return null;
  const { state } = data;
  if (state === "logged_out" || state === "invalid" || state === "unavailable") return { state };
  if (state !== "logged_in" || typeof data.username !== "string" || data.username === "") return null;
  const avatarUrl = urlWith(data.avatarUrl, ["https:"]);
  return {
    state,
    username: data.username,
    ...(typeof data.displayName === "string" && data.displayName !== "" ? { displayName: data.displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

function parseDeck(data: unknown): PresenterDeck | null {
  if (!isRecord(data)) return null;
  const { state } = data;
  if (state === "none") return { state };
  const url = urlWith(data.url, ["http:", "https:"]);
  if (state === "unpublished" || state === "missing" || state === "unverified") return { state, ...(url ? { url } : {}) };
  if (state !== "published") return null;
  const { visibility, version } = data;
  if (visibility !== "public" && visibility !== "unlisted") return null;
  return {
    state,
    visibility,
    ...(typeof version === "number" && Number.isInteger(version) && version >= 1 ? { version } : {}),
    ...(url ? { url } : {}),
  };
}

/** Reads the `/__banger/status` response without trusting it; null when it is not a status this runtime knows. */
export function parsePresenterStatus(data: unknown): PresenterStatus | null {
  if (!isRecord(data)) return null;
  const account = parseAccount(data.account);
  const deck = parseDeck(data.deck);
  return account && deck ? { account, deck } : null;
}

export function initialsOf(account: { username: string; displayName?: string }): string {
  const name = account.displayName || account.username;
  return Array.from(name)[0]?.toUpperCase() ?? "?";
}
