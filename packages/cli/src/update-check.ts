import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PACKAGE = "@bangerpage/cli";
const LATEST_URL = "https://registry.npmjs.org/@bangerpage%2fcli/latest";
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 2000;

interface Cache {
  checkedAt: number;
  latest: string;
}

export interface UpdateCheckOptions {
  current: string;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
  now?: number;
  cacheFile?: string;
  fetchLatest?: () => Promise<string | undefined>;
  write?: (text: string) => void;
}

export function updateCacheFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "banger", "update-check.json");
}

function enabled(env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  return isTTY && !env.CI && !env.BANGER_NO_UPDATE_CHECK && !env.NO_UPDATE_NOTIFIER;
}

function parse(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

/** True when `latest` is a release (no prerelease tag) newer than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

function readCache(file: string): Cache | undefined {
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<Cache>;
    return typeof data.checkedAt === "number" && typeof data.latest === "string"
      ? { checkedAt: data.checkedAt, latest: data.latest }
      : undefined;
  } catch {
    return undefined;
  }
}

async function fetchFromRegistry(): Promise<string | undefined> {
  const response = await fetch(LATEST_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) return undefined;
  const body = (await response.json()) as { version?: unknown };
  return typeof body.version === "string" ? body.version : undefined;
}

/**
 * Prints a notice when the last check found a newer release, and refreshes the check at most once a day.
 * The notice uses the cached result so a command never waits on the network; failures are ignored.
 */
export function checkForUpdate(opts: UpdateCheckOptions): Promise<void> {
  const env = opts.env ?? process.env;
  if (!enabled(env, opts.isTTY ?? process.stderr.isTTY === true)) return Promise.resolve();
  const file = opts.cacheFile ?? updateCacheFile(env);
  const now = opts.now ?? Date.now();
  const write = opts.write ?? ((text: string) => process.stderr.write(text));
  const cache = readCache(file);
  if (cache && isNewer(cache.latest, opts.current)) {
    write(`banger: ${cache.latest} is available (you have ${opts.current}). Update with: npm install -g ${PACKAGE}@latest\n`);
  }
  if (cache && now - cache.checkedAt < INTERVAL_MS) return Promise.resolve();
  return (opts.fetchLatest ?? fetchFromRegistry)()
    .then((latest) => {
      if (!latest) return;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, `${JSON.stringify({ checkedAt: now, latest } satisfies Cache)}\n`);
    })
    .catch(() => undefined);
}
