import { describe, it, expect } from "vitest";
import { PiAdapter } from "../index.js";

describe("PiAdapter", () => {
  const adapter = new PiAdapter();

  it("uses persistent execution mode", () => {
    expect(adapter.executionMode).toBe("persistent");
  });

  describe("canHandle", () => {
    it("handles pi with --mode rpc", () => {
      expect(PiAdapter.canHandle("pi --mode rpc")).toBe(true);
      expect(PiAdapter.canHandle("/usr/bin/pi --mode rpc")).toBe(true);
    });

    it("rejects pi without --mode rpc", () => {
      expect(PiAdapter.canHandle("pi")).toBe(false);
      expect(PiAdapter.canHandle("pi --interactive")).toBe(false);
    });

    it("rejects non-pi commands", () => {
      expect(PiAdapter.canHandle("aider --json")).toBe(false);
      expect(PiAdapter.canHandle("claude --print")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("formats as RPC prompt command (pi-mono RpcCommand)", () => {
      const result = adapter.formatInput({ id: "t1", message: "fix the bug" });
      const parsed = JSON.parse(result.trim());
      expect(parsed.type).toBe("prompt");
      expect(parsed.message).toBe("fix the bug");
    });
  });

  describe("parseOutput", () => {
    it("parses text events as progress", () => {
      const result = adapter.parseOutput('{"type":"text","content":"analyzing..."}');
      expect(result).toEqual({ type: "progress", text: "analyzing..." });
    });

    it("parses tool_call events as info logs", () => {
      const result = adapter.parseOutput('{"type":"tool_call","name":"read"}');
      expect(result).toEqual({ type: "log", level: "info", text: "🔧 read" });
    });

    it("parses tool_result events as success logs", () => {
      const result = adapter.parseOutput('{"type":"tool_result","name":"edit"}');
      expect(result).toEqual({ type: "log", level: "info", text: "✅ edit" });
    });

    it("parses done events as complete", () => {
      const result = adapter.parseOutput('{"type":"done","total_tokens":4231}');
      expect(result).toEqual({ type: "complete" });
    });

    it("parses error events as failed", () => {
      const result = adapter.parseOutput('{"type":"error","message":"API timeout"}');
      expect(result).toEqual({ type: "failed", text: "API timeout" });
    });

    it("ignores empty lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
    });

    it("handles non-JSON as info log", () => {
      const result = adapter.parseOutput("pi v1.2.3 starting...");
      expect(result).toEqual({ type: "log", level: "info", text: "pi v1.2.3 starting..." });
    });

    it("handles unknown JSON event types", () => {
      const result = adapter.parseOutput('{"type":"custom_event","data":123}');
      expect(result).toEqual({ type: "log", level: "info", text: '{"type":"custom_event","data":123}' });
    });
  });
});
