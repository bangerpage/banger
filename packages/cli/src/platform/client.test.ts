import { describe, expect, it } from "vitest";
import { ApiError, PlatformClient } from "./client.js";

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
