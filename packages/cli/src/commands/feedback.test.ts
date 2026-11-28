import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CliError } from "../errors.js";
import { browserCommand } from "../platform/browser-login.js";
import { credentialsPath, saveToken } from "../platform/client.js";
import {
  CONFIRM_REMINDER,
  DESTINATIONS,
  draftTemplate,
  issueBody,
  LIMITS,
  parseDraft,
  runCommand,
  runFeedback,
  scanDraft,
  stripComments,
  TITLE_PREFIX,
  webUrl,
  type ClientInfo,
  type FeedbackDeps,
  type RunResult,
} from "./feedback.js";

let root: string;
let stdout = "";
let stderr = "";
const saved = { ...process.env };
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../../");

const client: ClientInfo = { version: "0.2.3", skillVersion: "0.2.3", runtimeVersion: "0.2.3", node: "22.0.0", os: "darwin" };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "banger-feedback-test-"));
  process.env = { ...saved, XDG_CONFIG_HOME: join(root, "config"), BANGER_HOST: "https://example.test" };
  delete process.env.BANGER_TOKEN;
  stdout = "";
  stderr = "";
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout += String(chunk);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr += String(chunk);
    return true;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...saved };
  rmSync(root, { recursive: true, force: true });
});

const GOOD = `# a title

### What worked as expected

starter was enough

### What needed investigation

### What went beyond Banger's frame

needed bang-free for a curved arrow
`;

function draftFile(text = GOOD, name = "feedback.md"): string {
  const file = join(root, name);
  writeFileSync(file, text);
  return file;
}

interface Fakes {
  deps: FeedbackDeps;
  runs: { command: string; args: string[]; stdin?: string }[];
  opened: string[];
  fetches: { url: string; init: RequestInit }[];
  asked: string[];
}

function fakes(
  opts: {
    ghVersion?: number;
    ghAuth?: number;
    login?: string;
    create?: Partial<RunResult>;
    status?: number;
    body?: unknown;
    fetchError?: Error;
    isTTY?: boolean;
    answers?: string[];
  } = {},
): Fakes {
  const f: Fakes = { deps: {}, runs: [], opened: [], fetches: [], asked: [] };
  const answers = [...(opts.answers ?? [])];
  f.deps = {
    client,
    tmpdir: root,
    isTTY: opts.isTTY ?? false,
    run: async (command, args, stdin) => {
      f.runs.push({ command, args, stdin });
      if (args[0] === "--version") return { code: opts.ghVersion ?? 0, stdout: "", stderr: "" };
      if (args[0] === "auth") return { code: opts.ghAuth ?? 0, stdout: "", stderr: "" };
      if (args[0] === "api") return { code: 0, stdout: `${opts.login ?? "octo-cat"}\n`, stderr: "" };
      return { code: 0, stdout: "https://github.com/bangerpage/banger/issues/7\n", stderr: "", ...opts.create };
    },
    open: (url) => f.opened.push(url),
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      f.fetches.push({ url: String(url), init: init ?? {} });
      if (opts.fetchError) throw opts.fetchError;
      const data = opts.body ?? { id: "fb_1" };
      return new Response(typeof data === "string" ? data : JSON.stringify(data), { status: opts.status ?? 201 });
    }) as typeof fetch,
    ask: async (question) => {
      f.asked.push(question);
      return answers.shift() ?? "";
    },
  };
  return f;
}

const sent = (f: Fakes) => f.runs.some((r) => r.args[0] === "issue") || f.opened.length > 0 || f.fetches.length > 0;

async function failure(promise: Promise<number>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error("expected a CliError");
}

describe("feedback new", () => {
  it("AC-1 writes the draft under tmpdir with mode 0600 and nothing in the working directory", async () => {
    const before = readdirSync(process.cwd()).sort();
    expect(await runFeedback(["new"], { tmpdir: root })).toBe(0);
    const file = /^draft: (.+)$/m.exec(stdout)?.[1];
    expect(file).toBeDefined();
    expect(file!.startsWith(root)).toBe(true);
    expect(file).toMatch(/banger-feedback-[^/]+\/feedback\.md$/);
    expect(readFileSync(file!, "utf8")).toBe(draftTemplate());
    if (process.platform !== "win32") expect(statSync(file!).mode & 0o777).toBe(0o600);
    expect(readdirSync(process.cwd()).sort()).toEqual(before);
  });

  it("is a usage error with a positional and prints usage on --help", async () => {
    expect((await failure(runFeedback(["new", "x"]))).exitCode).toBe(2);
    expect(await runFeedback(["--help"])).toBe(0);
    expect(stdout).toContain("feedback send");
  });

  it("rejects a missing or unknown subcommand", async () => {
    expect((await failure(runFeedback([]))).exitCode).toBe(2);
    expect((await failure(runFeedback(["frob"]))).exitCode).toBe(2);
    expect((await failure(runFeedback(["send"]))).exitCode).toBe(2);
    expect((await failure(runFeedback(["send", "a", "b"]))).exitCode).toBe(2);
    expect((await failure(runFeedback(["send", draftFile(), "--via", "mail"]))).exitCode).toBe(2);
  });
});

describe("draft parsing", () => {
  const H1 = "### What worked as expected";
  const H2 = "### What needed investigation";
  const H3 = "### What went beyond Banger's frame";
  it.each([
    ["title 121 chars", `# ${"a".repeat(121)}\n\n${H1}\n\nx\n`],
    ["section 4001 chars", `# t\n\n${H1}\n\n${"a".repeat(4001)}\n`],
    ["text before the first section", `# t\n\nstray\n\n${H1}\n\nx\n`],
    ["a duplicated heading", `# t\n\n${H1}\n\nx\n\n${H1}\n\ny\n`],
    ["an Environment heading", `# t\n\n${H1}\n\nx\n\n### Environment\n\ny\n`],
    ["all sections empty", `# t\n\n${H1}\n\n${H2}\n\n${H3}\n`],
    ["no title line", `${H1}\n\nx\n`],
    ["an empty title", `# \n\n${H1}\n\nx\n`],
    ["a misspelled heading before any section", `# t\n\n### What worked\n\nx\n`],
  ])("AC-15 rejects %s", (_name, text) => {
    expect(() => parseDraft(stripComments(text))).toThrow(CliError);
    try {
      parseDraft(stripComments(text));
    } catch (error) {
      expect((error as CliError).exitCode).toBe(1);
    }
  });

  it("accepts 120 and 4000 characters and trims", () => {
    const draft = parseDraft(`# ${"a".repeat(120)}\n\n${H1}\n\n  ${"b".repeat(4000)}  \n`);
    expect(draft.title).toHaveLength(120);
    expect(draft.worked).toHaveLength(4000);
    expect(draft.investigated).toBe("");
  });

  it("strips comments but keeps the line count", () => {
    const text = "a <!-- x\ny --> b\nc";
    expect(stripComments(text)).toBe("a \n b\nc");
  });

  it("the template with only comments is rejected as empty", () => {
    expect(() => parseDraft(stripComments(draftTemplate()))).toThrow(/title/);
  });
});

describe("scanDraft", () => {
  const ctx = {
    secrets: ["tok_abcdefgh1234"],
    home: "/Users/alice",
    cwd: "/work/deck",
    username: "octocat",
    osUser: "alicesmith",
    host: "https://banger.page",
  };
  const kinds = (text: string, c = ctx) => scanDraft(text, c).map((f) => `${f.line}:${f.kind}`);

  it.each([
    ["a stored Banger token", "see tok_abcdefgh1234 here"],
    ["a GitHub token", `x ghp_${"a".repeat(20)}`],
    ["a GitHub token", `github_pat_${"a".repeat(22)}`],
    ["an API key", `sk-${"a".repeat(20)}`],
    ["a JWT", `eyJ${"a".repeat(8)}.${"b".repeat(8)}.${"c".repeat(8)}`],
    ["a private key", "-----BEGIN RSA PRIVATE KEY-----"],
    ["a secret assigned to a name", "API_KEY=abc"],
    ["an absolute path", "at /Users/bob/talk/index.html"],
    ["an absolute path", "at /home/bob/talk"],
    ["an absolute path", "at C:\\Users\\bob"],
    ["an absolute path", "at /work/deck/index.html"],
    ["a banger.page account name", "by Octocat today"],
    ["a banger.page deck URL", "https://banger.page/u/talk"],
    ["a banger.page deck URL", "banger.page/u/talk"],
    ["an email address", "me@example.com"],
    ["an AWS access key", "AKIAABCDEFGHIJKLMNOP"],
    ["a Slack token", "xoxb-1234567890-abcdef"],
    ["an npm token", `npm_${"a".repeat(36)}`],
    ["a Google API key", `AIza${"a".repeat(35)}`],
    ["a bearer token", `Authorization: Bearer ${"a".repeat(20)}`],
    ["a secret assigned to a name", `token: ${"a1".repeat(8)}`],
    ["a secret assigned to a name", `"apiKey": "${"x9".repeat(8)}"`],
    ["an absolute path", "at /Volumes/work/acme/deck"],
    ["an absolute path", "at /srv/acme/app"],
    ["an absolute path", "at C:/Users/bob"],
    ["an absolute path", "at D:\\projects\\acme"],
    ["a control character", "fine\rhidden"],
    ["a control character", "x \u001b[2K y"],
    ["a control character", "a \u202e b"],
    ["this computer's account name", "made by alicesmith"],
  ])("finds %s", (kind, text) => {
    expect(kinds(`ok\n${text}`)).toContain(`2:${kind}`);
  });

  it.each([
    "@bangerpage/core@0.2.0/dist/index.js",
    "octocats and my-octocat-x",
    "notbanger.page/u/talk",
    "https://banger.page",
    "https://banger.page/",
    "a plain sentence about bang-free",
    "a short tok_abc",
    "the `/__banger/status` endpoint and skill/reference/publishing.md",
    "https://cdn.jsdelivr.net/npm/@bangerpage/core@0.2.3/dist/index.js",
    "set the token: with --token",
    "a line ending in CRLF\r",
    "a\ttab",
  ])("does not flag %s", (text) => {
    expect(kinds(text)).toEqual([]);
  });

  it("never returns the value and ignores short secrets", () => {
    const found = scanDraft("tok_abcdefgh1234", ctx);
    expect(JSON.stringify(found)).not.toContain("abcdefgh");
    expect(scanDraft("short", { ...ctx, secrets: ["short"] })).toEqual([]);
  });

  it("skips the deck URL check for a host that is not a URL", () => {
    expect(scanDraft("localhost:8787/x", { ...ctx, host: "localhost:8787" })).toEqual([]);
  });

  it("finds a stored token split over lines", () => {
    expect(kinds("see tok_abcd\nefgh1234 here")).toContain("1:a stored Banger token split over lines");
  });

  it("reports at most one finding per kind per line", () => {
    expect(scanDraft("a@b.com c@d.com", { ...ctx })).toHaveLength(1);
  });
});

describe("send validation (AC-2)", () => {
  it.each([
    ["only comments", `# t\n\n### What worked as expected\n\n<!-- nothing -->\n`],
    ["an empty title", `# \n\n### What worked as expected\n\nx\n`],
    ["no title line", `### What worked as expected\n\nx\n`],
  ])("%s exits 1 and calls nothing", async (_name, text) => {
    const f = fakes();
    expect((await failure(runFeedback(["send", draftFile(text), "--via", "gh", "--yes"], f.deps))).exitCode).toBe(1);
    expect(f.runs).toEqual([]);
    expect(sent(f)).toBe(false);
  });

  it("a missing file exits 2", async () => {
    expect((await failure(runFeedback(["send", join(root, "none.md"), "--via", "web", "--yes"], fakes().deps))).exitCode).toBe(2);
  });
});

describe("send scan (AC-10)", () => {
  it("stops on a stored token, never prints it, and sends nothing", async () => {
    saveToken("https://example.test", "bgr_storedtoken99", "octocat");
    const f = fakes();
    const error = await failure(runFeedback(["send", draftFile("# t\n\n### What worked as expected\n\nuses bgr_storedtoken99 ok\n"), "--via", "inbox", "--yes"], f.deps));
    expect(error.exitCode).toBe(1);
    expect(error.message).toContain("line 5: a stored Banger token");
    expect(error.message).not.toContain("bgr_storedtoken99");
    expect(sent(f)).toBe(false);
  });

  it("trims CR and newline around BANGER_TOKEN", async () => {
    process.env.BANGER_TOKEN = "abcdefgh1234\r\n";
    const f = fakes();
    const error = await failure(runFeedback(["send", draftFile("# t\n\n### What worked as expected\n\nabcdefgh1234\n"), "--via", "web", "--dry-run"], f.deps));
    expect(error.message).toContain("a stored Banger token");
  });

  it("flags the stored username, paths, email, and deck URLs; dry-run too", async () => {
    saveToken("https://example.test", "bgr_x1234567", "octocat");
    const f = fakes();
    for (const line of [`by octocat`, `${homedir()}/x`, "me@example.com", "https://example.test/u/talk"]) {
      const error = await failure(runFeedback(["send", draftFile(`# t\n\n### What worked as expected\n\n${line}\n`), "--dry-run"], f.deps));
      expect(error.exitCode).toBe(1);
      expect(error.message).not.toContain(line);
    }
  });

  it("does not throw for a BANGER_HOST without a scheme", async () => {
    process.env.BANGER_HOST = "localhost:8787";
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "web", "--dry-run"], f.deps)).toBe(0);
    expect(stdout).not.toContain("localhost:8787");
  });

  it("does not read a broken credentials file as a failure", async () => {
    mkdirSync(dirname(credentialsPath()), { recursive: true });
    writeFileSync(credentialsPath(), "{not json");
    expect(await runFeedback(["send", draftFile(), "--via", "web", "--dry-run"], fakes().deps)).toBe(0);
  });

  it("neither scans nor sends text inside comments", async () => {
    saveToken("https://example.test", "bgr_storedtoken99", "octocat");
    const text = `# t\n\n### What worked as expected\n\nreal <!-- token=bgr_storedtoken99 /Users/x/y -->\n`;
    for (const via of ["gh", "web", "inbox"]) {
      stdout = "";
      const f = fakes();
      expect(await runFeedback(["send", draftFile(text), "--via", via, "--yes"], f.deps)).toBe(0);
      const seen = JSON.stringify([stdout, f.runs, f.opened, f.fetches.map((x) => x.init.body)]);
      expect(seen).not.toContain("bgr_storedtoken99");
      expect(seen).not.toContain("/Users/x/y");
    }
    stdout = "";
    const dry = fakes();
    expect(await runFeedback(["send", draftFile(text), "--via", "web", "--dry-run"], dry.deps)).toBe(0);
    expect(`${stdout}${decodeURIComponent(stdout)}`).not.toContain("bgr_storedtoken99");
    expect(decodeURIComponent(stdout)).not.toContain("/Users/x/y");
  });
});

describe("routes and confirmation (AC-6, AC-13)", () => {
  it("is exit 2 without --via or --yes outside a terminal", async () => {
    const f = fakes();
    expect((await failure(runFeedback(["send", draftFile(), "--yes"], f.deps))).exitCode).toBe(2);
    expect((await failure(runFeedback(["send", draftFile(), "--via", "gh"], f.deps))).exitCode).toBe(2);
    expect(sent(f)).toBe(false);
  });

  it("asks [y/N] in a terminal, and sends only on y or yes", async () => {
    for (const [answer, code] of [["n", 1], ["", 1], ["y", 0], ["YES", 0]] as const) {
      const f = fakes({ isTTY: true, answers: [answer] });
      expect(await runFeedback(["send", draftFile(), "--via", "web"], f.deps)).toBe(code);
      expect(f.opened.length).toBe(code === 0 ? 1 : 0);
      expect(f.asked).toEqual(["Send? [y/N] "]);
    }
  });

  it.each([
    ["1", "gh"],
    ["gh", "gh"],
    ["2", "web"],
    ["3", "inbox"],
    ["INBOX", "inbox"],
  ])("a terminal list: %s picks %s", async (answer, route) => {
    const f = fakes({ isTTY: true, answers: [answer, "y"] });
    expect(await runFeedback(["send", draftFile()], f.deps)).toBe(0);
    expect(stdout).toContain(DESTINATIONS[route as "gh"]);
  });

  it("a terminal list: an unknown answer exits 2", async () => {
    const f = fakes({ isTTY: true, answers: ["x"] });
    expect((await failure(runFeedback(["send", draftFile()], f.deps))).exitCode).toBe(2);
    expect(sent(f)).toBe(false);
  });

  it.each(["gh", "web", "inbox"] as const)("shows the destination, title, text and reminder for %s with and without --yes", async (route) => {
    for (const yes of [true, false]) {
      stdout = "";
      const f = fakes({ isTTY: !yes, answers: ["y"] });
      expect(await runFeedback(["send", draftFile(), "--via", route, ...(yes ? ["--yes"] : [])], f.deps)).toBe(0);
      expect(stdout).toContain(DESTINATIONS[route]);
      expect(stdout).toContain("a title");
      expect(stdout).toContain(route === "inbox" ? '"idempotency_key"' : "### What worked as expected");
      expect(stdout).toContain(CONFIRM_REMINDER);
      expect(f.asked.length).toBe(yes ? 0 : 1);
    }
  });
});

describe("--dry-run (AC-7)", () => {
  it("shows the issue and the inbox JSON without a terminal, --yes or --via, and sends nothing", async () => {
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--dry-run"], f.deps)).toBe(0);
    expect(stdout).toContain("### What worked as expected");
    expect(stdout).toContain('"schema_version": 1');
    expect(f.runs).toEqual([]);
    expect(sent(f)).toBe(false);
  });

  it("--via inbox shows only the JSON and --via web only the issue", async () => {
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "inbox", "--dry-run"], f.deps)).toBe(0);
    expect(stdout).toContain('"schema_version"');
    expect(stdout).not.toContain("### Environment");
    stdout = "";
    expect(await runFeedback(["send", draftFile(), "--via", "web", "--dry-run"], f.deps)).toBe(0);
    expect(stdout).not.toContain('"schema_version"');
    expect(f.runs).toEqual([]);
    expect(sent(f)).toBe(false);
  });

  it("--via gh reads the login but never creates an issue", async () => {
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "gh", "--dry-run"], f.deps)).toBe(0);
    expect(stdout).toContain("will post as octo-cat (public)");
    expect(f.runs.map((r) => r.args[0])).toEqual(["--version", "auth", "api"]);
  });

  it("--via gh says so when gh is not usable", async () => {
    const f = fakes({ ghAuth: 1 });
    expect(await runFeedback(["send", draftFile(), "--via", "gh", "--dry-run"], f.deps)).toBe(0);
    expect(stdout).toContain("gh: not installed or not logged in");
  });
});

describe("gh route (AC-3, AC-4, AC-17)", () => {
  it.each([
    ["gh is missing", { ghVersion: -1 }],
    ["gh is not logged in", { ghAuth: 1 }],
  ])("%s: exit 2, use --via web, no issue", async (_name, opts) => {
    const f = fakes(opts);
    const error = await failure(runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("--via web");
    expect(f.runs.some((r) => r.args[0] === "issue")).toBe(false);
  });

  it("shows the login and calls issue create with the exact argv and the body on stdin", async () => {
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps)).toBe(0);
    expect(stdout).toContain("will post as octo-cat (public)");
    const create = f.runs.find((r) => r.args[0] === "issue")!;
    expect(create.command).toBe("gh");
    expect(create.args).toEqual(["issue", "create", "-R", "github.com/bangerpage/banger", "-t", "feedback: a title", "-F", "-"]);
    expect(create.stdin).toBe(issueBody(parseDraft(GOOD), client));
    expect(stdout).toContain("created: https://github.com/bangerpage/banger/issues/7");
  });

  it("does not repeat a feedback: prefix", async () => {
    const f = fakes();
    await runFeedback(["send", draftFile(GOOD.replace("# a title", "# Feedback: a title")), "--via", "gh", "--yes"], f.deps);
    expect(f.runs.find((r) => r.args[0] === "issue")!.args[5]).toBe("Feedback: a title");
  });

  it.each(["", "a b;c"])("an unknown account (%j): --yes stops, a terminal lets the person decide", async (login) => {
    const f = fakes({ login });
    // fakes() answers `api user` with code 0, so make it fail for the empty case
    if (login === "") {
      f.deps.run = async (command, args, stdin) => {
        f.runs.push({ command, args, stdin });
        return { code: args[0] === "api" ? 1 : 0, stdout: "", stderr: "" };
      };
    }
    const error = await failure(runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps));
    expect(error.exitCode).toBe(2);
    expect(f.runs.some((r) => r.args[0] === "issue")).toBe(false);
    stdout = "";
    const g = fakes({ login, isTTY: true, answers: ["y"] });
    if (login === "") {
      g.deps.run = async (command, args, stdin) => {
        g.runs.push({ command, args, stdin });
        return { code: args[0] === "api" ? 1 : 0, stdout: "https://github.com/bangerpage/banger/issues/9", stderr: "" };
      };
    }
    expect(await runFeedback(["send", draftFile(), "--via", "gh"], g.deps)).toBe(0);
    expect(g.runs.filter((r) => r.args[0] === "issue")).toHaveLength(1);
    expect(stdout).toContain("will post as: unknown account");
  });

  it("a failing create is exit 2 with --via web, and nothing else is sent", async () => {
    const f = fakes({ create: { code: 1, stdout: "", stderr: "boom" } });
    const error = await failure(runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("boom");
    expect(error.message).toContain("--via web");
    expect(f.opened).toEqual([]);
    expect(f.fetches).toEqual([]);
  });

  it("code -1 without a timeout points to --via web", async () => {
    const f = fakes({ create: { code: -1, stdout: "", stderr: "" } });
    expect((await failure(runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps))).message).toContain("--via web");
  });

  it("a timeout warns the issue may exist and does not point to --via web", async () => {
    const f = fakes({ create: { code: -1, stdout: "", stderr: "", timedOut: true } });
    const error = await failure(runFeedback(["send", draftFile(), "--via", "gh", "--yes"], f.deps));
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain("may have been created");
    expect(error.message).not.toContain("--via web");
  });

  it("finds the URL on stderr and treats a missing URL as success", async () => {
    const onStderr = fakes({ create: { stdout: "", stderr: "Creating\nhttps://github.com/bangerpage/banger/issues/12\n" } });
    expect(await runFeedback(["send", draftFile(), "--via", "gh", "--yes"], onStderr.deps)).toBe(0);
    expect(stdout).toContain("created: https://github.com/bangerpage/banger/issues/12");
    stdout = "";
    const none = fakes({ create: { stdout: "done", stderr: "" } });
    expect(await runFeedback(["send", draftFile(), "--via", "gh", "--yes"], none.deps)).toBe(0);
    expect(stdout).toContain("the URL was not printed");
    expect(stdout).not.toContain("--via web");
  });
});

describe("web route (AC-5)", () => {
  it("browserCommand escapes & only for Windows", () => {
    expect(browserCommand("https://x/?a=1&b=2", "win32")).toEqual(["cmd", ["/c", "start", "", "https://x/?a=1^&b=2"]]);
    expect(browserCommand("https://x/?a=1&b=2", "darwin")).toEqual(["open", ["https://x/?a=1&b=2"]]);
    expect(browserCommand("https://x/?a=1&b=2", "linux")).toEqual(["xdg-open", ["https://x/?a=1&b=2"]]);
  });

  it("opens the new-issue page with the title and body encoded", async () => {
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "web", "--yes"], f.deps)).toBe(0);
    const url = new URL(f.opened[0]!);
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/bangerpage/banger/issues/new");
    expect(url.searchParams.get("template")).toBe("feedback.md");
    expect(url.searchParams.get("title")).toBe("feedback: a title");
    expect(url.searchParams.get("body")).toBe(issueBody(parseDraft(GOOD), client));
    expect(f.runs).toEqual([]);
  });

  it("falls back to a skeleton body when the URL would be too long", () => {
    const body = (n: number) => `# t\n\n### What worked as expected\n\n${"あ".repeat(n)}\n`;
    const short = webUrl(parseDraft(body(10)), client);
    expect(short.truncated).toBe(false);
    expect(short.url.length).toBeLessThanOrEqual(LIMITS.urlChars);
    const long = webUrl(parseDraft(body(4000)), client);
    expect(long.truncated).toBe(true);
    expect(long.url.length).toBeLessThanOrEqual(LIMITS.urlChars);
    expect(decodeURIComponent(new URL(long.url).searchParams.get("body")!)).toContain("_Paste your text here._");
    // The boundary: the largest text that still fits is not truncated, one more is.
    let n = 10;
    while (!webUrl(parseDraft(body(n + 1)), client).truncated) n += 1;
    expect(webUrl(parseDraft(body(n)), client).url.length).toBeLessThanOrEqual(LIMITS.urlChars);
  });

  it("tells the person to paste the full text when truncated", async () => {
    const f = fakes();
    await runFeedback(["send", draftFile(`# t\n\n### What worked as expected\n\n${"あ".repeat(4000)}\n`), "--via", "web", "--yes"], f.deps);
    expect(stdout).toContain("paste the full text");
    expect(stdout).toContain("あ".repeat(100));
  });
});

describe("inbox route (AC-8, AC-9, AC-15)", () => {
  it("posts anonymously with the schema body and a stable idempotency key", async () => {
    process.env.BANGER_TOKEN = "bgr_envtoken123";
    saveToken("https://example.test", "bgr_storedtoken99", "octocat");
    const f = fakes();
    expect(await runFeedback(["send", draftFile(), "--via", "inbox", "--yes"], f.deps)).toBe(0);
    expect(stdout).toContain("fb_1");
    const call = f.fetches[0]!;
    expect(call.url).toBe("https://example.test/api/v1/feedback");
    expect(call.init.method).toBe("POST");
    const headers = Object.fromEntries(Object.entries(call.init.headers as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    expect(headers).not.toHaveProperty("authorization");
    expect(headers).not.toHaveProperty("cookie");
    expect(call.init.redirect).toBe("error");
    expect(call.init.signal).toBeDefined();
    const body = call.init.body as string;
    for (const secret of ["bgr_envtoken123", "bgr_storedtoken99", "octocat", process.cwd(), homedir(), hostname()]) expect(body).not.toContain(secret);
    const payload = JSON.parse(body);
    expect(payload).toMatchObject({
      schema_version: 1,
      title: "a title",
      sections: { worked: "starter was enough", investigated: "", beyond: "needed bang-free for a curved arrow" },
      client: { name: "banger-cli", version: "0.2.3", skill_version: "0.2.3", runtime_version: "0.2.3", node: "22.0.0", os: "darwin" },
    });
    const expected = createHash("sha256")
      .update(JSON.stringify(["a title", "starter was enough", "", "needed bang-free for a curved arrow"]), "utf8")
      .digest("hex")
      .slice(0, 32);
    expect(payload.idempotency_key).toBe(expected);
  });

  it("the key follows the content, including which section holds it", async () => {
    const key = async (text: string) => {
      const f = fakes();
      await runFeedback(["send", draftFile(text), "--via", "inbox", "--yes"], f.deps);
      return JSON.parse(f.fetches[0]!.init.body as string).idempotency_key as string;
    };
    const a = await key(GOOD);
    expect(await key(GOOD)).toBe(a);
    expect(await key(GOOD.replace("a title", "other"))).not.toBe(a);
    const moved = `# a title\n\n### What worked as expected\n\n### What needed investigation\n\nstarter was enough\n\n### What went beyond Banger's frame\n\nneeded bang-free for a curved arrow\n`;
    expect(await key(moved)).not.toBe(a);
  });

  it.each([
    [201, { id: "x1" }, 0],
    [200, { id: "x1" }, 0],
  ])("HTTP %i with an id succeeds", async (status, body, code) => {
    const f = fakes({ status, body });
    expect(await runFeedback(["send", draftFile(), "--via", "inbox", "--yes"], f.deps)).toBe(code);
    expect(stdout).toContain("x1");
  });

  it.each([
    ["404", { status: 404 }],
    ["405", { status: 405 }],
    ["500", { status: 500 }],
    ["503", { status: 503 }],
    ["403", { status: 403 }],
    ["a network error", { fetchError: new Error("down") }],
    ["a timeout", { fetchError: Object.assign(new Error("t"), { name: "TimeoutError" }) }],
    ["an HTML 200", { status: 200, body: "<html>SECRET-BODY</html>" }],
    ["a 200 without an id", { status: 200, body: {} }],
  ])("%s is 'not available yet' with the draft path and the other routes", async (_name, opts) => {
    const f = fakes(opts);
    const file = draftFile();
    const error = await failure(runFeedback(["send", file, "--via", "inbox", "--yes"], f.deps));
    expect(error.exitCode).toBe(2);
    expect(`${stdout}${stderr}${error.message}`).not.toContain("SECRET-BODY");
    expect(error.message).toContain("not available yet");
    expect(error.message).toContain(file);
    expect(error.message).toContain("--via gh");
    expect(error.message).toContain("--via web");
    expect(existsSync(file)).toBe(true);
  });

  it.each([
    [400, 2],
    [413, 1],
    [429, 2],
  ])("HTTP %i is exit %i and the response body never shows", async (status, code) => {
    const f = fakes({ status, body: { error: { code: "x", message: "SECRET-BODY" } } });
    const error = await failure(runFeedback(["send", draftFile(), "--via", "inbox", "--yes"], f.deps));
    expect(error.exitCode).toBe(code);
    expect(error.message).toContain(`HTTP ${status}`);
    expect(`${stdout}${stderr}${error.message}`).not.toContain("SECRET-BODY");
  });

  const LONG = `# t\n\n### What worked as expected\n\n${"あ".repeat(3900)}\n\n### What needed investigation\n\n${"い".repeat(3900)}\n\n### What went beyond Banger's frame\n\n${"う".repeat(3900)}\n`;

  it("a body over 16384 bytes stops before the confirmation, but gh and web still work", async () => {
    const f = fakes();
    const error = await failure(runFeedback(["send", draftFile(LONG), "--via", "inbox", "--yes"], f.deps));
    expect(error.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(f.fetches).toEqual([]);
    const g = fakes();
    expect(await runFeedback(["send", draftFile(LONG), "--via", "web", "--dry-run"], g.deps)).toBe(0);
  });

  it("--dry-run is exit 1 for --via inbox and says 'too long' without --via", async () => {
    expect((await failure(runFeedback(["send", draftFile(LONG), "--via", "inbox", "--dry-run"], fakes().deps))).exitCode).toBe(1);
    expect(await runFeedback(["send", draftFile(LONG), "--dry-run"], fakes().deps)).toBe(0);
    expect(stdout).toContain("too long for the inbox");
  });

  it("choosing inbox from the list stops before asking to confirm", async () => {
    const f = fakes({ isTTY: true, answers: ["inbox", "y"] });
    const error = await failure(runFeedback(["send", draftFile(LONG)], f.deps));
    expect(error.exitCode).toBe(1);
    expect(f.asked).toEqual(["route (1-3 or name): "]);
    expect(stdout).not.toContain(CONFIRM_REMINDER);
    expect(stdout).not.toContain("schema_version");
    expect(f.fetches).toEqual([]);
  });
});

describe("issue template (AC-11)", () => {
  const template = readFileSync(join(repoRoot, ".github/ISSUE_TEMPLATE/feedback.md"), "utf8");
  const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("### "));

  it("has the same headings as the draft and the issue body", () => {
    expect(headings(template)).toEqual(headings(draftTemplate()).concat("### Environment"));
    expect(headings(template)).toEqual(headings(issueBody(parseDraft(GOOD), client)));
  });

  it("has the title prefix and the feedback label", () => {
    const front = /^---\n([\s\S]*?)\n---/.exec(template)![1]!;
    expect(front).toContain(`title: "${TITLE_PREFIX}"`);
    expect(front).toMatch(/^labels: feedback$/m);
  });
});

describe("documentation (AC-16)", () => {
  it.each(["README.md", "README.ja.md", "packages/cli/README.md"])("%s mentions banger feedback", (file) => {
    expect(readFileSync(join(repoRoot, file), "utf8")).toContain("banger feedback");
  });
});

describe("runCommand (AC-18)", () => {
  const posix = process.platform === "win32" ? it.skip : it;
  let bin: string;
  let originalPath: string | undefined;

  beforeEach(() => {
    bin = join(root, "bin");
    mkdirSync(bin);
    originalPath = process.env.PATH;
  });
  afterEach(() => {
    process.env.PATH = originalPath;
  });

  function fakeGh(script: string) {
    const file = join(bin, "gh");
    writeFileSync(file, `#!/bin/sh\n${script}\n`);
    chmodSync(file, 0o755);
    process.env.PATH = `${bin}${delimiter}/usr/bin${delimiter}/bin`;
  }

  posix("returns code -1 when the executable is missing", async () => {
    process.env.PATH = bin;
    const result = await runCommand("gh", ["--version"]);
    expect(result.code).toBe(-1);
  });

  posix("passes arguments and stdin without a shell", async () => {
    fakeGh('printf "%s|%s|" "$1" "$2"; cat');
    const result = await runCommand("gh", ["a b", ";echo x"], "body text");
    expect(result).toMatchObject({ code: 0, stdout: "a b|;echo x|body text" });
  });

  posix("returns the real exit code when the command does not read stdin", async () => {
    fakeGh("echo nope >&2; exit 1");
    const result = await runCommand("gh", [], "x".repeat(200_000));
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("nope");
  });

  posix("kills on timeout", async () => {
    fakeGh("exec sleep 5");
    const started = Date.now();
    const result = await runCommand("gh", [], undefined, 200);
    expect(result).toMatchObject({ code: -1, timedOut: true });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe("DESTINATIONS", () => {
  it("states what each route exposes", () => {
    expect(DESTINATIONS.gh).toContain("public");
    expect(DESTINATIONS.web).toContain("public");
    expect(DESTINATIONS.inbox).toContain("only the Banger maintainers read it");
    expect(DESTINATIONS.inbox).toContain("your IP address");
  });
});
