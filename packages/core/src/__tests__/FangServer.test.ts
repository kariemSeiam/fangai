import { describe, it } from "vitest";
import { FangServer } from "../FangServer.js";
import { BaseAdapter, type FangConfig, type Task, type TaskUpdate } from "../index.js";

class StubAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message;
  }
  parseOutput(): TaskUpdate | null {
    return null;
  }
}

function minimalConfig(overrides: Partial<FangConfig> = {}): FangConfig {
  return {
    cli: "echo",
    port: 0,
    name: "stub-agent",
    costTier: "cheap",
    specializations: ["code"],
    ...overrides,
  };
}

describe("FangServer", () => {
  it("starts and stops with explicit host", async () => {
    const s = new FangServer(
      minimalConfig({ host: "127.0.0.1" }),
      new StubAdapter()
    );
    await s.start();
    await s.stop();
  });

  it("starts and stops without host (default bind)", async () => {
    const s = new FangServer(minimalConfig(), new StubAdapter());
    await s.start();
    await s.stop();
  });
});
