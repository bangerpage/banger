import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { CliError } from "../errors.js";
import {
  ApiError,
  CredentialsUnreadableError,
  credentialsPath,
  exchangeCode,
  PlatformClient,
  platformHost,
  revokeToken,
  saveToken,
  storedToken,
} from "./client.js";

describe("PlatformClient", () => {
  it("turns a response that is not JSON into an ApiError", async () => {
    const fetchImpl = (async () => new Response("<html>captive portal</html>", { status: 200 })) as typeof fetch;
    const error = await new PlatformClient("https://example.test", "t", fetchImpl).me().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("invalid_response");
  });

  it("gives every API call a time limit", async () => {
    let signal: AbortSignal | undefined;
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return Response.json({ username: "u" });
    }) as typeof fetch;
    await new PlatformClient("https://example.test", "t", fetchImpl).me();
    expect(signal).toBeInstanceOf(AbortSignal);
  });
});

describe("platformHost", () => {
  it("takes https anywhere and http only on this machine", () => {
    expect(platformHost({})).toBe("https://banger.page");
    expect(platformHost({ BANGER_HOST: "https://staging.example.test/" })).toBe("https://staging.example.test");
    expect(platformHost({ BANGER_HOST: "http://127.0.0.1:8787" })).toBe("http://127.0.0.1:8787");
    expect(platformHost({ BANGER_HOST: "http://localhost:8787" })).toBe("http://localhost:8787");
    for (const bad of ["banger.page", "http://staging.example.test", "ftp://x.test"]) {
      expect(() => platformHost({ BANGER_HOST: bad }), bad).toThrow(CliError);
    }
  });
});

describe("requests outside the API client", () => {
  const capture = () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetchImpl = (async (_input: unknown, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return Response.json({ access_token: "t" });
    }) as typeof fetch;
    return { signals, fetchImpl };
  };

  it("exchangeCode, revokeToken and putBlob have time limits", async () => {
    const { signals, fetchImpl } = capture();
    await exchangeCode("https://example.test", { code: "c", verifier: "v", redirectUri: "r" }, fetchImpl);
    await revokeToken("https://example.test", "t", fetchImpl);
    await new PlatformClient("https://example.test", "t", fetchImpl).putBlob("https://blob.example.test/x", new Uint8Array(4));
    expect(signals).toHaveLength(3);
    for (const signal of signals) expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("reports a network failure as ApiError", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const error = await new PlatformClient("https://example.test", "t", fetchImpl)
      .putBlob("https://blob.example.test/x", new Uint8Array(1))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("network");
  });
});

describe("credentials file", () => {
  it("writes atomically and names an unreadable file", () => {
    const base = mkdtempSync(join(tmpdir(), "banger-cred-"));
    const env = { XDG_CONFIG_HOME: base };
    try {
      saveToken("https://example.test", "tok", "u", env);
      expect(storedToken("https://example.test", env)).toBe("tok");
      expect(readdirSync(dirname(credentialsPath(env)))).toEqual(["credentials.json"]);
      mkdirSync(dirname(credentialsPath(env)), { recursive: true });
      writeFileSync(credentialsPath(env), "{not json");
      expect(() => storedToken("https://example.test", env)).toThrow(CredentialsUnreadableError);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
