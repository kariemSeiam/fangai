import { describe, it, expect } from "vitest";
import { CodexAdapter } from "../index.js";

describe("CodexAdapter", () => {
  const adapter = new CodexAdapter();

  describe("canHandle", () => {
    it("matches codex --json", () => {
      expect(CodexAdapter.canHandle("codex --json")).toBe(true);
      expect(CodexAdapter.canHandle("codex --json --cwd /tmp")).toBe(true);
    });

    it("rejects codex without --json", () => {
      expect(CodexAdapter.canHandle("codex")).toBe(false);
    });

    it("rejects other CLIs", () => {
      expect(CodexAdapter.canHandle("claude --print")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("writes message with newline", () => {
      expect(adapter.formatInput({ id: "1", message: "fix bug" })).toBe("fix bug\n");
    });
  });

  describe("parseOutput", () => {
    it("parses item.output_text", () => {
      const u = adapter.parseOutput(
        JSON.stringify({ type: "item.output_text", text: "hello" })
      );
      expect(u).toEqual({ type: "progress", text: "hello" });
    });

    it("parses turn.completed", () => {
      expect(adapter.parseOutput(JSON.stringify({ type: "turn.completed" }))).toEqual({
        type: "complete",
      });
    });

    it("parses error", () => {
      const u = adapter.parseOutput(
        JSON.stringify({ type: "error", message: "boom" })
      );
      expect(u).toEqual({ type: "failed", text: "boom" });
    });
  });
});
