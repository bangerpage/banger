import { describe, expect, it } from "vitest";
import { initialsOf, parsePresenterStatus } from "./presenter-status.js";

const ok = { account: { state: "logged_in", username: "alice" }, deck: { state: "none" } };

describe("parsePresenterStatus", () => {
  it("reads a valid status and ignores unknown keys", () => {
    const status = parsePresenterStatus({
      account: { state: "logged_in", username: "alice", displayName: "Alice", avatarUrl: "https://x.test/a.png", extra: 1 },
      deck: { state: "published", visibility: "unlisted", version: 3, url: "https://x.test/alice/t" },
    });
    expect(status).toEqual({
      account: { state: "logged_in", username: "alice", displayName: "Alice", avatarUrl: "https://x.test/a.png" },
      deck: { state: "published", visibility: "unlisted", version: 3, url: "https://x.test/alice/t" },
    });
    for (const state of ["logged_out", "invalid", "unavailable"]) expect(parsePresenterStatus({ ...ok, account: { state } })?.account.state).toBe(state);
    for (const state of ["unpublished", "missing", "unverified"]) expect(parsePresenterStatus({ ...ok, deck: { state } })?.deck.state).toBe(state);
  });

  it("returns null for anything else", () => {
    for (const bad of [null, "x", [], {}, { deck: { state: "none" } }, { account: ok.account }]) expect(parsePresenterStatus(bad)).toBeNull();
    expect(parsePresenterStatus({ ...ok, account: { state: "weird" } })).toBeNull();
    expect(parsePresenterStatus({ ...ok, account: { state: "logged_in" } })).toBeNull();
    expect(parsePresenterStatus({ ...ok, account: { state: "logged_in", username: "" } })).toBeNull();
    expect(parsePresenterStatus({ ...ok, deck: { state: "weird" } })).toBeNull();
    expect(parsePresenterStatus({ ...ok, deck: { state: "published", visibility: "team" } })).toBeNull();
  });

  it("drops avatar and deck urls that are not safe", () => {
    for (const avatarUrl of ["http://x.test/a.png", "javascript:alert(1)", 5]) {
      expect(parsePresenterStatus({ ...ok, account: { state: "logged_in", username: "a", avatarUrl } })?.account).toEqual({ state: "logged_in", username: "a" });
    }
    expect(parsePresenterStatus({ ...ok, deck: { state: "unverified", url: "javascript:alert(1)" } })?.deck).toEqual({ state: "unverified" });
    expect(parsePresenterStatus({ ...ok, deck: { state: "published", visibility: "public", version: 0 } })?.deck).toEqual({ state: "published", visibility: "public" });
  });
});

describe("initialsOf", () => {
  it("uses the display name, then the username, as one upper-case code point", () => {
    expect(initialsOf({ username: "alice", displayName: "bob" })).toBe("B");
    expect(initialsOf({ username: "alice", displayName: "" })).toBe("A");
    expect(initialsOf({ username: "alice" })).toBe("A");
    expect(initialsOf({ username: "x", displayName: "𠮷野" })).toBe("𠮷");
  });
});
