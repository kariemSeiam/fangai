import { describe, it, expect, vi } from "vitest";
import { apiKeyGate, extractApiKeyFromRequest } from "../apiKeyGate.js";

describe("extractApiKeyFromRequest", () => {
  it("reads Bearer token", () => {
    expect(
      extractApiKeyFromRequest({
        headers: { authorization: "Bearer abc123" },
      })
    ).toBe("abc123");
  });

  it("reads X-Api-Key", () => {
    expect(
      extractApiKeyFromRequest({
        headers: { "x-api-key": "secret" },
      })
    ).toBe("secret");
  });
});

describe("apiKeyGate", () => {
  it("calls next when no key configured", () => {
    const gate = apiKeyGate(undefined);
    const next = vi.fn();
    gate({ headers: {} } as never, {} as never, next);
    expect(next).toHaveBeenCalled();
  });

  it("calls next when Bearer matches", () => {
    const gate = apiKeyGate("k1");
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    gate(
      { headers: { authorization: "Bearer k1" } } as never,
      res as never,
      next
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when key mismatches", () => {
    const gate = apiKeyGate("k1");
    const next = vi.fn();
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    gate({ headers: {} } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
