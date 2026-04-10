import { describe, it, expect, beforeEach } from "vitest";
import { TaskManager } from "../TaskManager.js";
import type { SSEEmitter } from "../SSEEmitter.js";

describe("TaskManager", () => {
  let tm: TaskManager;

  beforeEach(() => {
    tm = new TaskManager();
  });

  describe("create", () => {
    it("creates a task in submitted state", () => {
      const task = tm.create("t1", "fix the bug");
      expect(task.id).toBe("t1");
      expect(task.status).toBe("submitted");
      expect(task.message).toBe("fix the bug");
      expect(task.updates).toEqual([]);
      expect(task.createdAt).toBeGreaterThan(0);
    });
  });

  describe("update", () => {
    it("transitions submitted to running on first update", () => {
      tm.create("t1", "test");
      tm.update("t1", { type: "progress", text: "working..." });
      const task = tm.get("t1")!;
      expect(task.status).toBe("running");
      expect(task.updates).toHaveLength(1);
    });

    it("accumulates multiple updates", () => {
      tm.create("t1", "test");
      tm.update("t1", { type: "progress", text: "step 1" });
      tm.update("t1", { type: "progress", text: "step 2" });
      tm.update("t1", { type: "log", level: "info", text: "🔧 read" });
      const task = tm.get("t1")!;
      expect(task.updates).toHaveLength(3);
    });

    it("ignores updates for unknown tasks", () => {
      expect(() => tm.update("ghost", { type: "progress", text: "hello" })).not.toThrow();
    });
  });

  describe("complete", () => {
    it("transitions running to completed", () => {
      tm.create("t1", "test");
      tm.update("t1", { type: "progress", text: "analyzing..." });
      tm.update("t1", { type: "progress", text: "fixed!" });
      tm.complete("t1");
      const task = tm.get("t1")!;
      expect(task.status).toBe("completed");
      expect(task.result).toBe("analyzing...fixed!");
      expect(task.completedAt).toBeGreaterThan(0);
    });

    it("handles tasks with no progress updates", () => {
      tm.create("t1", "test");
      tm.complete("t1");
      const task = tm.get("t1")!;
      expect(task.status).toBe("completed");
      expect(task.result).toBe("");
    });
  });

  describe("fail", () => {
    it("transitions to failed with error message", () => {
      tm.create("t1", "test");
      tm.fail("t1", "CLI exited with code 1");
      const task = tm.get("t1")!;
      expect(task.status).toBe("failed");
      expect(task.error).toBe("CLI exited with code 1");
    });
  });

  describe("get", () => {
    it("returns undefined for unknown tasks", () => {
      expect(tm.get("ghost")).toBeUndefined();
    });
  });

  describe("subscribe / unsubscribe", () => {
    it("manages subscribers without error", () => {
      const mockEmitter = { send: () => {}, close: () => {} } as unknown as SSEEmitter;
      tm.create("t1", "test");
      tm.subscribe("t1", mockEmitter);
      tm.unsubscribe("t1", mockEmitter);
      // No crash = pass
    });
  });
});
