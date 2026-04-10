import { describe, it, expect } from "vitest";
import { AiderAdapter } from "../index.js";

describe("AiderAdapter", () => {
  const adapter = new AiderAdapter();

  describe("canHandle", () => {
    it("handles aider commands", () => {
      expect(AiderAdapter.canHandle("aider")).toBe(true);
      expect(AiderAdapter.canHandle("aider --no-auto-commits --json")).toBe(true);
    });

    it("rejects non-aider commands", () => {
      expect(AiderAdapter.canHandle("pi --mode rpc")).toBe(false);
      expect(AiderAdapter.canHandle("claude --print")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("appends /exit command", () => {
      const result = adapter.formatInput({ id: "t1", message: "fix the bug" });
      expect(result).toBe("fix the bug\n/exit\n");
    });
  });

  describe("parseOutput", () => {
    it("parses assistant events as progress", () => {
      const result = adapter.parseOutput('{"type":"assistant","content":"Refactoring..."}');
      expect(result).toEqual({ type: "progress", text: "Refactoring..." });
    });

    it("parses commit events as info logs", () => {
      const result = adapter.parseOutput('{"type":"commit","commit_hash":"abc123"}');
      expect(result).toEqual({ type: "log", level: "info", text: "✅ committed: abc123" });
    });

    it("parses diff events", () => {
      const result = adapter.parseOutput('{"type":"diff","files":["src/auth.ts","src/user.ts"]}');
      expect(result).toEqual({ type: "log", level: "info", text: "📝 changed: src/auth.ts, src/user.ts" });
    });

    it("handles plain text as progress", () => {
      const result = adapter.parseOutput("I'll refactor the auth module...");
      expect(result).toEqual({ type: "progress", text: "I'll refactor the auth module..." });
    });

    it("ignores empty lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
    });
  });
});
