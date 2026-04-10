import { describe, it, expect } from "vitest";
import { detectHostAgents } from "../hostDetect.js";

describe("detectHostAgents", () => {
  it(
    "returns a sorted array (may be empty)",
    async () => {
      const rows = await detectHostAgents();
      expect(Array.isArray(rows)).toBe(true);
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i]!.tier).toBeGreaterThanOrEqual(rows[i - 1]!.tier);
      }
    },
    15_000
  );
});
