import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { parseArgsStrict } from "../args.js";
import { CliError } from "../errors.js";
import { ApiError, PlatformClient, platformHost, tokenFor, type DeckResult, type UploadFile } from "../platform/client.js";
import { checkDeck } from "./check.js";

const USAGE =
  "usage: banger publish [dir] [--slug <slug>] [--title <title>] [--visibility public|unlisted] [--strict] [--skip-check] [--dry-run]";

/** The kinds of file banger.page accepts besides index.html; it decides their type from the extension. */
const ACCEPTED: Record<string, true> = Object.fromEntries(
  [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".woff2", ".mp4", ".webm", ".json", ".css", ".js", ".pdf"].map((e) => [e, true]),
);

export const LIMITS = { html: 2 * 1024 * 1024, file: 10 * 1024 * 1024, total: 50 * 1024 * 1024, files: 200 };

export interface DeckFile extends UploadFile {
  abs: string;
}

function isAccepted(path: string): boolean {
  return path === "index.html" || extname(path).toLowerCase() in ACCEPTED;
}

/** The files `banger publish` sends from `dir`, and the ones it leaves out because banger.page does not take them. */
export function collectDeck(dir: string): { files: DeckFile[]; skipped: string[] } {
  const root = resolve(dir);
  if (!existsSync(join(root, "index.html"))) throw new CliError(2, `no index.html in ${root}`);
  const files: DeckFile[] = [];
  const skipped: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const abs = join(current, entry.name);
      const path = relative(root, abs).split(sep).join("/");
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isAccepted(path)) {
        skipped.push(path);
        continue;
      }
      const body = readFileSync(abs);
      files.push({ abs, path, size: body.length, sha256: createHash("sha256").update(body).digest("hex") });
    }
  };
  walk(root);
  return { files, skipped };
}

/** Problems with the limits banger.page enforces, so a publish fails here instead of after the upload. */
export function limitProblems(files: UploadFile[]): string[] {
  const problems: string[] = [];
  if (files.length > LIMITS.files) problems.push(`${files.length} files; at most ${LIMITS.files} can be published`);
  for (const f of files) {
    const limit = f.path === "index.html" ? LIMITS.html : LIMITS.file;
    if (f.size > limit) problems.push(`${f.path} is ${formatSize(f.size)}; the limit is ${formatSize(limit)}`);
  }
  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > LIMITS.total) problems.push(`the files add up to ${formatSize(total)}; the limit is ${formatSize(LIMITS.total)}`);
  return problems;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A slug from a directory name: lower case letters, digits and single hyphens. */
export function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

interface DeckState {
  decks: Record<string, { slug: string; url: string }>;
}

function statePath(dir: string): string {
  return join(resolve(dir), ".banger", "deck.json");
}

function readState(dir: string): DeckState {
  const file = statePath(dir);
  if (!existsSync(file)) return { decks: {} };
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as Partial<DeckState>;
    return { decks: data.decks && typeof data.decks === "object" ? data.decks : {} };
  } catch {
    throw new CliError(2, `${file} could not be read; fix or delete it`);
  }
}

function writeState(dir: string, state: DeckState): void {
  const file = statePath(dir);
  mkdirSync(join(resolve(dir), ".banger"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

export async function runPublish(argv: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  if (argv.includes("--help")) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(argv, {
    slug: { type: "string" },
    title: { type: "string" },
    visibility: { type: "string" },
    strict: { type: "boolean" },
    "skip-check": { type: "boolean" },
    "dry-run": { type: "boolean" },
  });
  if (positionals.length > 1) throw new CliError(2, USAGE);
  const dir = positionals[0] ?? ".";
  if (values.visibility !== undefined && values.visibility !== "public" && values.visibility !== "unlisted") {
    throw new CliError(2, `--visibility must be public or unlisted\n${USAGE}`);
  }
  if (values.slug !== undefined && slugFrom(values.slug) !== values.slug) {
    throw new CliError(2, `--slug may use lower case letters, digits and single hyphens: ${values.slug}`);
  }

  const { files, skipped } = collectDeck(dir);
  const total = files.reduce((sum, f) => sum + f.size, 0);
  for (const f of files) process.stdout.write(`  ${f.path}  ${formatSize(f.size)}\n`);
  process.stdout.write(`${files.length} files, ${formatSize(total)}\n`);
  if (skipped.length > 0) process.stderr.write(`not sent (banger.page does not take these): ${skipped.join(", ")}\n`);
  const problems = limitProblems(files);
  if (problems.length > 0) throw new CliError(1, problems.join("\n"));

  if (!values["skip-check"]) {
    const result = await checkDeck(join(resolve(dir), "index.html"));
    for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
    for (const failure of result.failed) process.stderr.write(`failed: ${failure}\n`);
    if (result.failed.length > 0 || (values.strict && result.warnings.length > 0)) {
      throw new CliError(1, "banger check found problems; fix them, or pass --skip-check to publish anyway");
    }
  }
  if (values["dry-run"]) return 0;

  const host = platformHost();
  const token = tokenFor(host);
  if (!token) throw new CliError(2, `not logged in to ${host}; run banger login --token <token>`);
  const client = new PlatformClient(host, token, fetchImpl);
  const state = readState(dir);
  const known = state.decks[host];
  const updating = known !== undefined && (values.slug === undefined || values.slug === known.slug);

  let result: DeckResult;
  try {
    const plan = await client.beginUpload(files.map(({ path, sha256, size }) => ({ path, sha256, size })));
    const bySha = new Map(files.map((f) => [f.sha256, f]));
    for (const blob of plan.uploads) {
      const file = bySha.get(blob.sha256);
      if (!file) throw new CliError(1, `${host} asked for a file that was not offered (${blob.path})`);
      await client.putBlob(blob.url, readFileSync(file.abs), blob.method);
    }
    process.stdout.write(`sent ${plan.uploads.length} of ${files.length} files (the rest were already on ${host})\n`);
    const idempotency_key = randomUUID();
    const strict = values.strict === true;
    if (updating) {
      result = await client.update(known.slug, {
        upload_id: plan.upload_id,
        strict,
        idempotency_key,
        ...(values.title ? { title: values.title } : {}),
        ...(values.visibility ? { visibility: values.visibility } : {}),
      });
    } else {
      const slug = values.slug ?? (slugFrom(basename(resolve(dir))) || undefined);
      result = await client.publish({
        upload_id: plan.upload_id,
        idempotency_key,
        strict,
        ...(slug ? { slug } : {}),
        ...(values.title ? { title: values.title } : {}),
        ...(values.visibility ? { visibility: values.visibility } : {}),
      });
    }
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 401) throw new CliError(2, `${host} did not accept the token; run banger login --token <token> again`);
    if (error.code === "slug_taken") throw new CliError(1, `${error.message}\npick another slug with --slug`);
    if (error.code === "pro_required") throw new CliError(1, `${error.message}\n(--visibility unlisted needs a paid plan)`);
    if (error.code === "not_found" && updating) {
      throw new CliError(1, `${error.message}\nthe deck ${known.slug} is gone; delete ${statePath(dir)} to publish it as a new deck`);
    }
    throw new CliError(1, `${host}: ${error.message}`);
  }

  state.decks[host] = { slug: result.slug, url: result.url };
  writeState(dir, state);
  const version = result.version === undefined ? "" : ` (version ${result.version})`;
  process.stdout.write(`${updating ? "updated" : "published"}${version}: ${result.url}\n`);
  return 0;
}
