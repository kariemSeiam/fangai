import { describe, it, expect } from "vitest";
import { CursorAdapter } from "../index.js";

describe("CursorAdapter", () => {
  const adapter = new CursorAdapter();

  // ── canHandle ────────────────────────────────────────────────────────

  describe("canHandle", () => {
    it("matches cursor-agent commands", () => {
      expect(CursorAdapter.canHandle("cursor-agent --print")).toBe(true);
      expect(
        CursorAdapter.canHandle(
          "cursor-agent --print --output-format stream-json --yolo --trust"
        )
      ).toBe(true);
    });

    it("rejects non-cursor commands", () => {
      expect(CursorAdapter.canHandle("claude --print")).toBe(false);
      expect(CursorAdapter.canHandle("pi --mode rpc")).toBe(false);
      expect(CursorAdapter.canHandle("aider")).toBe(false);
      expect(CursorAdapter.canHandle("opencode")).toBe(false);
    });
  });

  // ── formatInput ──────────────────────────────────────────────────────

  describe("formatInput", () => {
    it("passes message with trailing newline", () => {
      expect(adapter.formatInput({ id: "t1", message: "fix the auth bug" })).toBe(
        "fix the auth bug\n"
      );
    });

    it("preserves multiline messages", () => {
      const msg = "line one\nline two";
      expect(adapter.formatInput({ id: "t2", message: msg })).toBe(msg + "\n");
    });
  });

  // ── parseOutput — stream-json events ─────────────────────────────────

  describe("parseOutput — stream-json", () => {
    it("parses assistant text as progress", () => {
      const line = JSON.stringify({
        type: "assistant",
        content: "I'll analyze the authentication module...",
        session_id: "abc-123",
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "progress",
        text: "I'll analyze the authentication module...",
      });
    });

    it("skips empty assistant content", () => {
      const line = JSON.stringify({ type: "assistant", content: "", session_id: "abc" });
      expect(adapter.parseOutput(line)).toBeNull();
    });

    it("parses tool_call_started", () => {
      const line = JSON.stringify({
        type: "tool_call_started",
        tool: { name: "read", input: { path: "src/auth.ts" } },
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "🔧 → read",
      });
    });

    it("parses tool_call_started with shell tool", () => {
      const line = JSON.stringify({
        type: "tool_call_started",
        tool: { name: "shell", input: { command: "npm test" } },
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "🔧 → shell",
      });
    });

    it("parses tool_call_started with edit tool", () => {
      const line = JSON.stringify({
        type: "tool_call_started",
        tool: { name: "edit", input: { path: "src/auth.ts" } },
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "🔧 → edit",
      });
    });

    it("parses tool_call_completed with short output", () => {
      const line = JSON.stringify({
        type: "tool_call_completed",
        tool: { name: "read" },
        output: "file contents here",
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "✅ ← read (file contents here)",
      });
    });

    it("parses tool_call_completed with long output (truncated)", () => {
      const longOutput = "x".repeat(200);
      const line = JSON.stringify({
        type: "tool_call_completed",
        tool: { name: "shell" },
        output: longOutput,
      });
      const result = adapter.parseOutput(line);
      expect(result?.type).toBe("log");
      if (result?.type === "log") {
        expect(result.text).toContain("✅ ← shell (");
        // Truncated to 77 chars + "..."
        expect(result.text.length).toBeLessThan(200);
      }
    });

    it("parses tool_call_completed without output", () => {
      const line = JSON.stringify({
        type: "tool_call_completed",
        tool: { name: "edit" },
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "✅ ← edit",
      });
    });

    it("parses result (success) as complete", () => {
      const line = JSON.stringify({
        type: "result",
        content: "The bug has been fixed in src/auth.ts",
        session_id: "abc-123",
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "complete",
        result: "The bug has been fixed in src/auth.ts",
      });
    });

    it("parses result with empty content as complete with 'ok'", () => {
      const line = JSON.stringify({
        type: "result",
        session_id: "abc-123",
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "complete",
        result: "ok",
      });
    });

    it("parses result with error as failed", () => {
      const line = JSON.stringify({
        type: "result",
        error: true,
        content: "Rate limit exceeded",
      });
      expect(adapter.parseOutput(line)).toEqual({
        type: "failed",
        text: "Rate limit exceeded",
      });
    });

    it("skips system events", () => {
      const line = JSON.stringify({ type: "system", version: "2026.05.01" });
      expect(adapter.parseOutput(line)).toBeNull();
    });

    it("skips user echo events", () => {
      const line = JSON.stringify({
        type: "user",
        content: "fix the auth bug",
      });
      expect(adapter.parseOutput(line)).toBeNull();
    });

    it("handles unknown JSON events as log", () => {
      const line = JSON.stringify({ type: "custom_event", data: "something" });
      const result = adapter.parseOutput(line);
      expect(result?.type).toBe("log");
    });
  });

  // ── parseOutput — plain text fallback ────────────────────────────────

  describe("parseOutput — plain text fallback", () => {
    it("treats plain text as progress", () => {
      expect(adapter.parseOutput("Building the project...")).toEqual({
        type: "progress",
        text: "Building the project...",
      });
    });

    it("strips ANSI color codes", () => {
      expect(adapter.parseOutput("\x1b[32mAll tests passed\x1b[0m")).toEqual({
        type: "progress",
        text: "All tests passed",
      });
    });

    it("ignores empty and whitespace-only lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
      expect(adapter.parseOutput("\t\n")).toBeNull();
    });

    it("ignores ANSI-only lines", () => {
      expect(adapter.parseOutput("\x1b[0m")).toBeNull();
    });
  });

  // ── parseOutput — edge cases ─────────────────────────────────────────

  describe("parseOutput — edge cases", () => {
    it("handles truncated JSON gracefully", () => {
      const truncated = '{"type":"assistant","content":"thi';
      // Should not throw — returns log
      const result = adapter.parseOutput(truncated);
      expect(result).not.toBeNull();
      expect(result?.type).toBe("log");
    });

    it("handles tool_call_started with missing tool name", () => {
      const line = JSON.stringify({ type: "tool_call_started" });
      expect(adapter.parseOutput(line)).toEqual({
        type: "log",
        level: "info",
        text: "🔧 → unknown",
      });
    });

    it("handles tool_call_completed with missing tool", () => {
      const line = JSON.stringify({ type: "tool_call_completed", output: "done" });
      const result = adapter.parseOutput(line);
      expect(result?.type).toBe("log");
      if (result?.type === "log") {
        expect(result.text).toContain("✅ ← unknown");
      }
    });
  });
});
