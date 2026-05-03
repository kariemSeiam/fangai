import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callJsonRpc, FangClient } from "../index.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

describe("callJsonRpc", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs JSON-RPC to {base}/a2a and returns result", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        jsonrpc: "2.0",
        id: "x",
        result: { done: true },
      })
    );

    const r = await callJsonRpc(
      "http://127.0.0.1:3001",
      "message/send",
      { message: { kind: "message" } }
    );
    expect(r).toEqual({ done: true });
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/a2a/jsonrpc",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
  });

  it("sends Authorization Bearer when apiKey is set", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ jsonrpc: "2.0", id: "x", result: null })
    );

    await callJsonRpc("http://localhost:1/", "ping", {}, { apiKey: "secret" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:1/a2a/jsonrpc",
      expect.objectContaining({
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer secret",
        }),
      })
    );
  });
});

describe("FangClient", () => {
  it("base strips trailing slash", () => {
    const c = new FangClient("http://localhost:3009/");
    expect(c.base).toBe("http://localhost:3009");
  });
});
