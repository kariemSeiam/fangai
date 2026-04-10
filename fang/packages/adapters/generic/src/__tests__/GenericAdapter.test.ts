import { describe, it, expect } from "vitest";
import { GenericAdapter } from "../index.js";

describe("GenericAdapter", () => {
  const adapter = new GenericAdapter();

  describe("canHandle", () => {
    it("always returns true", () => {
      expect(GenericAdapter.canHandle("anything")).toBe(true);
      expect(GenericAdapter.canHandle("")).toBe(true);
      expect(GenericAdapter.canHandle("pi --mode rpc")).toBe(true);
    });
  });

  describe("formatInput", () => {
    it("passes message as-is with newline", () => {
      const result = adapter.formatInput({ id: "t1", message: "hello" });
      expect(result).toBe("hello\n");
    });
  });

  describe("parseOutput", () => {
    it("treats every non-empty line as progress", () => {
      const result = adapter.parseOutput("some output");
      expect(result).toEqual({ type: "progress", text: "some output" });
    });

    it("strips ANSI codes", () => {
      const result = adapter.parseOutput("\x1b[31merror\x1b[0m");
      expect(result).toEqual({ type: "progress", text: "error" });
    });

    it("ignores empty lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
    });
  });
});
