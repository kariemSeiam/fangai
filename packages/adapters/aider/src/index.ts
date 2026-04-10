import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Adapter for aider --json
 *
 * aider with --json outputs structured events:
 *   { "type": "assistant", "content": "..." }
 *   { "type": "commit", "commit_hash": "abc123" }
 *   { "type": "diff", "files": ["src/auth.ts"] }
 *
 * Input: plain text + /exit command
 */
export class AiderAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message + "\n/exit\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    if (!line.trim()) return null;

    try {
      const event = JSON.parse(line);
      const type = event.type as string;

      if (type === "assistant") {
        return { type: "progress", text: event.content ?? "" };
      }
      if (type === "commit") {
        return {
          type: "log",
          level: "info",
          text: `✅ committed: ${event.commit_hash}`,
        };
      }
      if (type === "diff") {
        return {
          type: "log",
          level: "info",
          text: `📝 changed: ${(event.files as string[]).join(", ")}`,
        };
      }
      return { type: "log", level: "info", text: line };
    } catch {
      // Plain text output — stream as progress
      return { type: "progress", text: line };
    }
  }

  static canHandle(cli: string): boolean {
    return cli.startsWith("aider");
  }
}
