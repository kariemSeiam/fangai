import { describe, it, expect } from "vitest";
import { ClaudeAdapter } from "../index.js";

describe("ClaudeAdapter", () => {
  const adapter = new ClaudeAdapter();

  describe("canHandle", () => {
    it("handles claude commands", () => {
      expect(ClaudeAdapter.canHandle("claude --print")).toBe(true);
      expect(ClaudeAdapter.canHandle("claude")).toBe(true);
    });

    it("rejects non-claude commands", () => {
      expect(ClaudeAdapter.canHandle("pi --mode rpc")).toBe(false);
      expect(ClaudeAdapter.canHandle("aider")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("passes message as-is with newline", () => {
      const result = adapter.formatInput({ id: "t1", message: "fix the bug" });
      expect(result).toBe("fix the bug\n");
    });
  });

  describe("parseOutput", () => {
    it("streams text as progress", () => {
      const result = adapter.parseOutput("I'll analyze the auth module...");
      expect(result).toEqual({ type: "progress", text: "I'll analyze the auth module..." });
    });

    it("strips ANSI color codes", () => {
      const result = adapter.parseOutput("\x1b[32mSuccess!\x1b[0m");
      expect(result).toEqual({ type: "progress", text: "Success!" });
    });

    it("ignores empty lines and ANSI-only lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
      expect(adapter.parseOutput("\x1b[0m")).toBeNull();
    });
  });
});
