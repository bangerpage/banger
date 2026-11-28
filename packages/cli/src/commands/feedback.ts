import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { parseArgsStrict } from "../args.js";
import { CliError, readInput } from "../errors.js";
import { openInBrowser } from "../platform/browser-login.js";
import { allStoredTokens, platformHost, storedUsername } from "../platform/client.js";
import { bundledSkill, cliVersion } from "./skill.js";

export type Route = "gh" | "web" | "inbox";

export interface Draft {
  title: string;
  worked: string;
  investigated: string;
  beyond: string;
}

export interface Finding {
  line: number;
  kind: string;
}

export interface ClientInfo {
  version: string;
  skillVersion: string;
  runtimeVersion: string;
  node: string;
  os: string;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface FeedbackDeps {
  /** Runs a command without a shell. A missing executable is code -1; a kill on timeout is code -1 with timedOut. */
  run?: (command: string, args: string[], stdin?: string) => Promise<RunResult>;
  open?: (url: string) => void;
  fetchImpl?: typeof fetch;
  isTTY?: boolean;
  /** Writes the question to stdout and reads one line; closed input gives an empty string. */
  ask?: (question: string) => Promise<string>;
  tmpdir?: string;
  client?: ClientInfo;
}

export const LIMITS = {
  title: 120,
  section: 4000,
  inboxBytes: 16 * 1024,
  urlChars: 6000,
  inboxTimeoutMs: 5000,
  ghTimeoutMs: 30000,
} as const;

export const TITLE_PREFIX = "feedback: ";
export const REPO = "bangerpage/banger";

export const SECTIONS: readonly { key: "worked" | "investigated" | "beyond"; heading: string; hint: string }[] = [
  {
    key: "worked",
    heading: "### What worked as expected",
    hint: "What the AI understood and built straight from the skill, the CLI and the docs.",
  },
  {
    key: "investigated",
    heading: "### What needed investigation",
    hint: "What could not be built without digging: what you looked up, and where.",
  },
  {
    key: "beyond",
    heading: "### What went beyond Banger's frame",
    hint: "What a deck adjustment could not do and needed bang-free, custom CSS or a runtime workaround. Say what notation or component you wanted.",
  },
];

const ENVIRONMENT_HEADING = "### Environment";

export const DESTINATIONS: Record<Route, string> = {
  gh: `A public GitHub issue on ${REPO}, created by your gh login. It is public and tied to your GitHub account.`,
  web: `A public GitHub issue on ${REPO} that you submit by hand in the browser. It is public once you press Submit.`,
  inbox:
    "The banger.page feedback inbox, sent anonymously: only the Banger maintainers read it. The inbox can see your IP address.",
};

export const CONFIRM_REMINDER =
  "Check that nothing confidential or personal is in this text: company or customer names, unreleased plans, what is inside your deck, or private details from your conversation with the AI.";

const FEEDBACK_USAGE = `usage: banger feedback new
       banger feedback send <file> [--via gh|web|inbox] [--yes] [--dry-run]

new   writes a draft (feedback.md) in a temporary directory and prints its path.
send  checks the draft, shows the exact text and where it goes, then sends it:
        gh     a public GitHub issue made by your gh login
        web    prints the text and opens the new-issue page for you to submit
        inbox  the banger.page feedback inbox, anonymously
      --yes skips only the [y/N] question, not the display; use it only after a person has read the text.
      --dry-run shows the final text and sends nothing.
`;

export function draftTemplate(): string {
  const sections = SECTIONS.map((s) => `${s.heading}\n\n<!-- ${s.hint} -->\n`).join("\n");
  return `# \n\n<!-- First line: a one-line title, after "# ". -->\n\n${sections}`;
}

/** Removes `<!-- -->` comments but keeps their newlines, so line numbers match the file. */
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ""));
}

export function parseDraft(stripped: string): Draft {
  const lines = stripped.split("\n");
  const titleAt = lines.findIndex((line) => line.trim() !== "");
  const titleLine = titleAt === -1 ? "" : lines[titleAt]!.trimEnd();
  if (titleAt === -1 || !/^#(\s|$)/.test(titleLine)) throw new CliError(1, 'write a title on the first line, after "# "');
  const title = titleLine.slice(1).trim();
  if (title === "") throw new CliError(1, 'write a title on the first line, after "# "');
  if (title.length > LIMITS.title) throw new CliError(1, `the title is ${title.length} characters; the limit is ${LIMITS.title}`);

  const headings = SECTIONS.map((s) => s.heading);
  const bodies = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of lines.slice(titleAt + 1)) {
    const trimmed = line.trim();
    if (trimmed === ENVIRONMENT_HEADING) throw new CliError(1, `${ENVIRONMENT_HEADING} is written by banger; remove it`);
    if (headings.includes(trimmed)) {
      if (bodies.has(trimmed)) throw new CliError(1, `the heading "${trimmed}" appears twice`);
      current = [];
      bodies.set(trimmed, current);
    } else if (current) {
      current.push(line);
    } else if (trimmed !== "") {
      throw new CliError(1, `text before the first section; use the three headings: ${headings.join(", ")}`);
    }
  }

  const draft: Draft = { title, worked: "", investigated: "", beyond: "" };
  for (const section of SECTIONS) {
    const body = (bodies.get(section.heading) ?? []).join("\n").trim();
    if (body.length > LIMITS.section) {
      throw new CliError(1, `"${section.heading}" is ${body.length} characters; the limit is ${LIMITS.section}`);
    }
    draft[section.key] = body;
  }
  if (draft.worked === "" && draft.investigated === "" && draft.beyond === "") {
    throw new CliError(1, "nothing to send: all three sections are empty");
  }
  return draft;
}

export interface ScanContext {
  secrets: string[];
  home: string;
  cwd: string;
  username?: string;
  /** The account name on this computer. */
  osUser?: string;
  host?: string;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const PATTERNS: { kind: string; test: RegExp }[] = [
  { kind: "a GitHub token", test: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { kind: "a GitHub token", test: /\bgithub_pat_[A-Za-z0-9_]{20,}/ },
  { kind: "an API key", test: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { kind: "a JWT", test: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/ },
  { kind: "a private key", test: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: "an AWS access key", test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { kind: "a Slack token", test: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { kind: "an npm token", test: /\bnpm_[A-Za-z0-9]{36}\b/ },
  { kind: "a Google API key", test: /\bAIza[0-9A-Za-z_-]{35}/ },
  { kind: "a bearer token", test: /\bbearer\s+[A-Za-z0-9._~+/-]{16,}/i },
  { kind: "a secret assigned to a name", test: /\b\w*(?:key|token|secret|password|passwd|credential)\w*\s*=\s*\S+/i },
  {
    kind: "a secret assigned to a name",
    test: /\b\w*(?:key|token|secret|password|passwd|credential)\w*["']?\s*:\s*["']?[A-Za-z0-9_\-./+=]{12,}/i,
  },
  { kind: "an absolute path", test: /\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:[\\/]Users[\\/]/ },
  {
    kind: "an absolute path",
    test: /(?<![\w.:/-])\/(?:Volumes|srv|opt|mnt|private|var|tmp|root|workspaces?|data|media|net)\/[^\s/]+\/?/,
  },
  { kind: "an absolute path", test: /(?<![\w])[A-Za-z]:[\\/][^\s\\/]+[\\/]/ },
  // Carriage returns, escape sequences and bidi overrides can hide part of a line from the person who checks it.
  { kind: "a control character", test: /[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/ },
  { kind: "an email address", test: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/ },
];

/** Looks for secrets, paths, accounts and addresses. Reports line numbers and kinds only, never the matched value. */
export function scanDraft(text: string, ctx: ScanContext): Finding[] {
  const secrets = ctx.secrets.filter((secret) => secret.length >= 8);
  const roots = [ctx.home, ctx.cwd].filter((root) => root.length >= 2 && root !== "/");
  const username = ctx.username && ctx.username.length >= 3 ? ctx.username : undefined;
  const usernameTest = username ? new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(username)}(?![A-Za-z0-9_-])`, "i") : undefined;
  let deckUrlTest: RegExp | undefined;
  if (ctx.host) {
    try {
      const host = new URL(ctx.host).host;
      if (host !== "") deckUrlTest = new RegExp(`(?<![A-Za-z0-9.-])${escapeRegExp(host)}/\\S`, "i");
    } catch {
      // A BANGER_HOST that is not a URL has no deck URLs to look for.
    }
  }

  const osUser = ctx.osUser && ctx.osUser.length >= 4 ? ctx.osUser : undefined;
  const osUserTest = osUser ? new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(osUser)}(?![A-Za-z0-9_-])`, "i") : undefined;

  const findings: Finding[] = [];
  // A token split over lines or by spaces is still the token.
  const squeezed = text.replace(/\s+/g, "");
  const split = secrets.filter((secret) => squeezed.includes(secret) && !text.split("\n").some((line) => line.includes(secret)));
  if (split.length > 0) findings.push({ line: 1, kind: "a stored Banger token split over lines" });
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.replace(/\r$/, "");
    const kinds = new Set<string>();
    if (secrets.some((secret) => line.includes(secret))) kinds.add("a stored Banger token");
    if (osUserTest?.test(line)) kinds.add("this computer's account name");
    for (const { kind, test } of PATTERNS) {
      if (test.test(line)) kinds.add(kind);
    }
    if (roots.some((root) => line.includes(root))) kinds.add("an absolute path");
    if (usernameTest?.test(line)) kinds.add("a banger.page account name");
    if (deckUrlTest?.test(line)) kinds.add("a banger.page deck URL");
    for (const kind of kinds) findings.push({ line: index + 1, kind });
  });
  return findings;
}

export function issueTitle(draft: Draft): string {
  return /^feedback:/i.test(draft.title) ? draft.title : `${TITLE_PREFIX}${draft.title}`;
}

export function issueBody(draft: Draft, client: ClientInfo, opts: { skeleton?: boolean } = {}): string {
  const parts = SECTIONS.map((section) => {
    const content = opts.skeleton ? "_Paste your text here._" : draft[section.key] || "_None._";
    return `${section.heading}\n\n${content}\n`;
  });
  const environment = [
    ENVIRONMENT_HEADING,
    "",
    `- banger CLI: ${client.version}`,
    `- skill: ${client.skillVersion}`,
    `- runtime (@bangerpage/core): ${client.runtimeVersion}`,
    `- Node.js: ${client.node}`,
    `- OS: ${client.os}`,
    "",
  ].join("\n");
  return `${parts.join("\n")}\n${environment}`;
}

export function webUrl(draft: Draft, client: ClientInfo): { url: string; truncated: boolean } {
  const build = (title: string, body: string) =>
    `https://github.com/${REPO}/issues/new?template=feedback.md&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  const full = build(issueTitle(draft), issueBody(draft, client));
  if (full.length <= LIMITS.urlChars) return { url: full, truncated: false };
  return { url: build(issueTitle(draft), issueBody(draft, client, { skeleton: true })), truncated: true };
}

export function idempotencyKey(draft: Draft): string {
  return createHash("sha256")
    .update(JSON.stringify([draft.title, draft.worked, draft.investigated, draft.beyond]), "utf8")
    .digest("hex")
    .slice(0, 32);
}

export function inboxPayload(draft: Draft, client: ClientInfo) {
  return {
    schema_version: 1,
    idempotency_key: idempotencyKey(draft),
    title: draft.title,
    sections: { worked: draft.worked, investigated: draft.investigated, beyond: draft.beyond },
    client: {
      name: "banger-cli",
      version: client.version,
      skill_version: client.skillVersion,
      runtime_version: client.runtimeVersion,
      node: client.node,
      os: client.os,
    },
  };
}

/** Versions come from an allow list; nothing that names the person or the machine goes in. */
export function clientInfo(): ClientInfo {
  const clean = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 32) : "unknown");
  const attempt = <T>(read: () => T, fallback: T): T => {
    try {
      return read();
    } catch {
      return fallback;
    }
  };
  const meta = attempt(() => JSON.parse(readFileSync(join(bundledSkill(), "meta.json"), "utf8")) as Record<string, unknown>, {});
  return {
    version: clean(attempt(cliVersion, "")),
    skillVersion: clean(meta.skillVersion),
    runtimeVersion: clean(meta.runtimeVersion),
    node: clean(process.versions.node),
    os: clean(process.platform),
  };
}

/** Never rejects. A missing executable is code -1; a kill (the timeout) is code -1 with `timedOut`. */
export function runCommand(command: string, args: string[], stdin?: string, timeoutMs: number = LIMITS.ghTimeoutMs): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    let child;
    try {
      child = spawn(command, args, { shell: false, timeout: timeoutMs });
    } catch (error) {
      finish({ code: -1, stdout, stderr: (error as Error).message });
      return;
    }
    // gh can exit before it reads stdin; the EPIPE is not a failure of ours, the exit code tells what happened.
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (error) => finish({ code: -1, stdout, stderr: stderr || error.message }));
    child.on("close", (code) => {
      if (code === null) finish({ code: -1, stdout, stderr, timedOut: true });
      else finish({ code, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

async function ghReady(run: NonNullable<FeedbackDeps["run"]>): Promise<boolean> {
  if ((await run("gh", ["--version"])).code !== 0) return false;
  return (await run("gh", ["auth", "status", "--hostname", "github.com"])).code === 0;
}

export async function ghLogin(run: NonNullable<FeedbackDeps["run"]>): Promise<string | null> {
  const result = await run("gh", ["api", "--hostname", "github.com", "user", "--jq", ".login"]);
  if (result.code !== 0) return null;
  const login = result.stdout.trim();
  return /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : null;
}

function defaultAsk(question: string): Promise<string> {
  process.stdout.write(question);
  return new Promise((resolvePromise) => {
    const rl = createInterface({ input: process.stdin });
    let answered = false;
    rl.once("line", (line) => {
      answered = true;
      rl.close();
      resolvePromise(line);
    });
    rl.once("close", () => {
      if (!answered) resolvePromise("");
    });
  });
}

const out = (text: string) => process.stdout.write(text);

function loginLine(login: string | null): string {
  return login === null ? "will post as: unknown account (check gh auth status)" : `will post as ${login} (public)`;
}

function showFinal(route: Route, draft: Draft, client: ClientInfo, login: string | null): void {
  out(`\nsend to: ${DESTINATIONS[route]}\n`);
  if (route === "gh") out(`${loginLine(login)}\n`);
  out(`\ntitle: ${route === "inbox" ? draft.title : issueTitle(draft)}\n\n`);
  out(route === "inbox" ? `${JSON.stringify(inboxPayload(draft, client), null, 2)}\n` : issueBody(draft, client));
  out(`\n${CONFIRM_REMINDER}\n\n`);
}

function inboxBody(draft: Draft, client: ClientInfo): { body: string; bytes: number } {
  const body = JSON.stringify(inboxPayload(draft, client));
  return { body, bytes: Buffer.byteLength(body) };
}

function tooLong(bytes: number): CliError {
  return new CliError(
    1,
    `the inbox message is ${bytes} bytes; the inbox takes at most ${LIMITS.inboxBytes}. Shorten the draft, or use --via gh or --via web`,
  );
}

function newDraft(rest: string[], deps: FeedbackDeps): number {
  if (rest.includes("--help")) {
    out(FEEDBACK_USAGE);
    return 0;
  }
  const { positionals } = parseArgsStrict(rest, {});
  if (positionals.length > 0) throw new CliError(2, FEEDBACK_USAGE);
  const dir = mkdtempSync(join(deps.tmpdir ?? tmpdir(), "banger-feedback-"));
  const file = join(dir, "feedback.md");
  writeFileSync(file, draftTemplate(), { mode: 0o600, flag: "wx" });
  out(`draft: ${file}\n\nwrite the draft, show it to the person, and send it with: banger feedback send ${file} --via gh|web|inbox\n`);
  return 0;
}

async function sendDraft(rest: string[], deps: FeedbackDeps): Promise<number> {
  if (rest.includes("--help")) {
    out(FEEDBACK_USAGE);
    return 0;
  }
  const { values, positionals } = parseArgsStrict(rest, {
    via: { type: "string" },
    yes: { type: "boolean" },
    "dry-run": { type: "boolean" },
  });
  if (positionals.length !== 1) throw new CliError(2, FEEDBACK_USAGE);
  const file = positionals[0]!;
  if (values.via !== undefined && values.via !== "gh" && values.via !== "web" && values.via !== "inbox") {
    throw new CliError(2, `--via takes gh, web or inbox\n${FEEDBACK_USAGE}`);
  }
  let via = values.via as Route | undefined;

  // The comment-free text is the only thing that is checked, parsed and sent.
  const stripped = stripComments(readInput(file));
  const draft = parseDraft(stripped);

  const host = platformHost();
  let username: string | undefined;
  try {
    username = storedUsername(host) ?? undefined;
  } catch {
    // A broken credentials file only narrows the check.
  }
  const secrets: string[] = [];
  const fromEnv = process.env.BANGER_TOKEN?.trim();
  if (fromEnv) secrets.push(fromEnv);
  try {
    secrets.push(...allStoredTokens());
  } catch {
    // Same: keep scanning with what could be read.
  }
  let osUser: string | undefined;
  try {
    osUser = userInfo().username;
  } catch {
    // No account name to look for.
  }
  const findings = scanDraft(stripped, { secrets, home: homedir(), cwd: process.cwd(), username, osUser, host });
  if (findings.length > 0) {
    const list = findings.map((f) => `  line ${f.line}: ${f.kind}`).join("\n");
    throw new CliError(1, `the draft has text that must not be sent:\n${list}\nrewrite those lines; nothing was sent`);
  }

  const client = deps.client ?? clientInfo();
  const run = deps.run ?? runCommand;

  if (values["dry-run"]) {
    if (via === "gh") {
      const ready = await ghReady(run);
      out(`\n${DESTINATIONS.gh}\n`);
      out(ready ? `${loginLine(await ghLogin(run))}\n` : "gh: not installed or not logged in\n");
    }
    if (via !== "inbox") {
      if (via !== "gh") out(`\n${via === "web" ? DESTINATIONS.web : `${DESTINATIONS.gh}\n(or by hand: ${DESTINATIONS.web})`}\n`);
      out(`\ntitle: ${issueTitle(draft)}\n\n${issueBody(draft, client)}`);
    }
    if (via === undefined || via === "inbox") {
      const { bytes } = inboxBody(draft, client);
      if (bytes > LIMITS.inboxBytes) {
        if (via === "inbox") throw tooLong(bytes);
        out(`\n${DESTINATIONS.inbox}\ntoo long for the inbox (${bytes} bytes, limit ${LIMITS.inboxBytes})\n`);
      } else {
        out(`\n${DESTINATIONS.inbox}\n${JSON.stringify(inboxPayload(draft, client), null, 2)}\n`);
      }
    }
    out(`\n${CONFIRM_REMINDER}\n\nnothing was sent (--dry-run)\n`);
    return 0;
  }

  const tty = deps.isTTY ?? (process.stdin.isTTY === true && process.stdout.isTTY === true);
  if (!tty) {
    if (via === undefined) throw new CliError(2, "--via is required when not in a terminal (gh, web or inbox)");
    if (!values.yes) throw new CliError(2, "a person has to look at the text and confirm; pass --yes only after they have");
  }

  const ask = deps.ask ?? defaultAsk;
  if (via === undefined) {
    const ready = await ghReady(run);
    out(
      `\nwhere should this go?\n  1. gh     ${ready ? "a public GitHub issue made by your gh login" : "not available: gh is not installed or not logged in"}\n  2. web    a public GitHub issue you submit by hand in the browser\n  3. inbox  the banger.page feedback inbox, anonymous\n`,
    );
    const answer = (await ask("route (1-3 or name): ")).trim().toLowerCase();
    const chosen: Record<string, Route> = { "1": "gh", gh: "gh", "2": "web", web: "web", "3": "inbox", inbox: "inbox" };
    via = chosen[answer];
    if (via === undefined) throw new CliError(2, "no route chosen");
  }
  const route: Route = via;

  let login: string | null = null;
  let inbox: { body: string; bytes: number } | undefined;
  if (route === "gh") {
    if (!(await ghReady(run))) throw new CliError(2, "gh is not installed or not logged in; use --via web");
    login = await ghLogin(run);
    if (values.yes && login === null) {
      throw new CliError(
        2,
        "could not tell which GitHub account gh would post as; run gh auth status, or send without --yes in a terminal",
      );
    }
  } else if (route === "inbox") {
    inbox = inboxBody(draft, client);
    if (inbox.bytes > LIMITS.inboxBytes) throw tooLong(inbox.bytes);
  }

  showFinal(route, draft, client, login);
  if (!values.yes) {
    const answer = (await ask("Send? [y/N] ")).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      out("not sent\n");
      return 1;
    }
  }

  if (route === "gh") return sendViaGh(draft, client, run);
  if (route === "web") return sendViaWeb(draft, client, deps);
  return sendToInbox(inbox!.body, file, deps);
}

async function sendViaGh(draft: Draft, client: ClientInfo, run: NonNullable<FeedbackDeps["run"]>): Promise<number> {
  const result = await run(
    "gh",
    ["issue", "create", "-R", `github.com/${REPO}`, "-t", issueTitle(draft), "-F", "-"],
    issueBody(draft, client),
  );
  const issues = `https://github.com/${REPO}/issues`;
  if (result.timedOut) {
    throw new CliError(2, `gh did not finish within ${LIMITS.ghTimeoutMs / 1000} s; the issue may have been created. Check ${issues} before sending again`);
  }
  if (result.code !== 0) {
    throw new CliError(2, `gh could not create the issue (exit ${result.code}): ${result.stderr.slice(0, 500)}\nuse --via web`);
  }
  const url = /https:\/\/github\.com\/bangerpage\/banger\/issues\/\d+/.exec(`${result.stdout}\n${result.stderr}`)?.[0];
  out(url ? `created: ${url}\n` : `created: (the URL was not printed; check ${issues})\n`);
  return 0;
}

function sendViaWeb(draft: Draft, client: ClientInfo, deps: FeedbackDeps): number {
  const { url, truncated } = webUrl(draft, client);
  (deps.open ?? openInBrowser)(url);
  out(`opened: ${url}\nthe issue is not created until you press Submit new issue in the browser\n`);
  if (truncated) out("the text is long, so only the headings were filled in; paste the full text shown above\n");
  return 0;
}

async function sendToInbox(body: string, file: string, deps: FeedbackDeps): Promise<number> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  let status = 0;
  let id: string | undefined;
  try {
    // No authorization and no cookie: the message is anonymous. A redirect is an error, not something to follow.
    const response = await fetchImpl(`${platformHost()}/api/v1/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(LIMITS.inboxTimeoutMs),
    });
    status = response.status;
    if (status === 200 || status === 201) {
      try {
        const data = (await response.json()) as { id?: unknown } | null;
        if (data && typeof data.id === "string") id = data.id;
      } catch {
        // Not JSON: treated as unavailable below.
      }
    }
  } catch {
    status = 0;
  }
  if (id !== undefined) {
    out(`sent to the banger.page feedback inbox (id: ${id})\n`);
    return 0;
  }
  if (status === 400) {
    throw new CliError(2, "the inbox did not accept this version of banger's message format (HTTP 400); update banger, or use --via gh or --via web");
  }
  if (status === 413) throw new CliError(1, "the inbox says the message is too long (HTTP 413); shorten the draft");
  if (status === 429) throw new CliError(2, "too many messages from this network (HTTP 429); try again later, or use --via gh or --via web");
  const path = resolve(file);
  const reason = status === 0 ? "no answer" : `HTTP ${status}`;
  throw new CliError(
    2,
    `the banger.page feedback inbox is not available yet (${reason})\nyour draft is saved at ${path}\nsend it another way:\n  banger feedback send ${path} --via gh\n  banger feedback send ${path} --via web`,
  );
}

export async function runFeedback(argv: string[], deps: FeedbackDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === "--help" || sub === "-h") {
    out(FEEDBACK_USAGE);
    return 0;
  }
  if (sub === "new") return newDraft(rest, deps);
  if (sub === "send") return sendDraft(rest, deps);
  throw new CliError(2, FEEDBACK_USAGE);
}
