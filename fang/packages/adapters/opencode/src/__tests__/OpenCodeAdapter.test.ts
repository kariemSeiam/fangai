import { describe, it, expect } from "vitest";
import { OpenCodeAdapter } from "../index.js";

describe("OpenCodeAdapter", () => {
  const adapter = new OpenCodeAdapter();

  describe("canHandle", () => {
    it("handles opencode commands", () => {
      expect(OpenCodeAdapter.canHandle("opencode")).toBe(true);
      expect(OpenCodeAdapter.canHandle("opencode run --format json")).toBe(true);
    });

    it("rejects non-opencode commands", () => {
      expect(OpenCodeAdapter.canHandle("pi --mode rpc")).toBe(false);
      expect(OpenCodeAdapter.canHandle("aider")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("formats as JSON prompt", () => {
      const result = adapter.formatInput({ id: "t1", message: "fix bug" });
      const parsed = JSON.parse(result.trim());
      expect(parsed.prompt).toBe("fix bug");
    });
  });

  describe("parseOutput", () => {
    it("handles text events (legacy content field)", () => {
      const result = adapter.parseOutput('{"type":"text","content":"working..."}');
      expect(result).toEqual({ type: "progress", text: "working..." });
    });

    it("handles opencode run --format json text lines (part.text)", () => {
      const line = JSON.stringify({
        type: "text",
        timestamp: 1,
        sessionID: "s1",
        part: { type: "text", text: "hello", time: { end: 1 } },
      });
      const result = adapter.parseOutput(line);
      expect(result).toEqual({ type: "progress", text: "hello" });
    });

    it("handles done events", () => {
      const result = adapter.parseOutput('{"type":"done","result":"fixed"}');
      expect(result).toEqual({ type: "complete", result: "fixed" });
    });

    it("handles error events", () => {
      const result = adapter.parseOutput('{"type":"error","message":"failed"}');
      expect(result).toEqual({ type: "failed", text: "failed" });
    });

    it("falls back to plain text", () => {
      const result = adapter.parseOutput("some output");
      expect(result).toEqual({ type: "progress", text: "some output" });
    });
  });
});
