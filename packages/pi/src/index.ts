import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Pi (Fang) — JSONL adapter for `pi --mode rpc`.
 *
 * Pi speaks one JSON object per line on stdout. Fang reads line-by-line and
 * turns that into `TaskUpdate`s for the A2A bridge. Use with:
 *
 *   fang wrap "pi --mode rpc" --port 3001
 *
 * Install this package if you load Fang from source; published `@fangai/cli`
 * will list it as an optional peer for Pi users.
 *
 * Event shapes (typical):
 *   { "type": "text", "content": "..." }
 *   { "type": "tool_call", "name": "read", "input": {...} }
 *   { "type": "tool_result", "name": "read", "output": "..." }
 *   { "type": "done", "total_tokens": 4231 }
 *   { "type": "error", "message": "..." }
 *
 * Stdin: one JSON RPC command per task (Fang writes once per A2A message). Matches
 * pi-mono `RpcCommand` — see `packages/coding-agent/src/modes/rpc/rpc-types.ts`.
 */
export class PiAdapter extends BaseAdapter {
  get executionMode(): "oneshot" | "persistent" {
    return "persistent";
  }

  formatInput(task: Task): string {
    return JSON.stringify({ type: "prompt", message: task.message }) + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    if (!line.trim()) return null;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      return { type: "log", level: "info", text: line };
    }

    const type = event.type as string;

    switch (type) {
      case "text":
        return { type: "progress", text: (event.content as string) ?? "" };

      case "tool_call":
        return {
          type: "log",
          level: "info",
          text: `🔧 ${event.name}`,
        };

      case "tool_result":
        return {
          type: "log",
          level: "info",
          text: `✅ ${event.name}`,
        };

      case "done":
        return { type: "complete" };

      case "error":
        return {
          type: "failed",
          text: (event.message as string) ?? "unknown error",
        };

      default:
        return { type: "log", level: "info", text: line };
    }
  }

  static canHandle(cli: string): boolean {
    return /\bpi\b/.test(cli) && cli.includes("--mode rpc");
  }
}
