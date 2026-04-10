import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Adapter for OpenCode JSON lines on stdout.
 *
 * Upstream `opencode run --format json` writes one JSON object per line with
 * `type`, `timestamp`, `sessionID`, and event-specific fields (see
 * anomalyco/opencode `packages/opencode/src/cli/cmd/run.ts`).
 *
 * Note: default `opencode run` passes the user message via argv/SDK, not stdin.
 * This adapter is for **piped** json output or future wrappers; first-class
 * integration may use `opencode serve` + HTTP instead.
 */
export class OpenCodeAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return JSON.stringify({ prompt: task.message }) + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    if (!line.trim()) return null;

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const type = event.type as string | undefined;

      if (type === "text") {
        const part = event.part as { text?: string } | undefined;
        const text =
          (typeof part?.text === "string" && part.text) ||
          (event.content as string) ||
          (event.text as string) ||
          "";
        if (text) return { type: "progress", text };
      }

      if (type === "response" || type === "content") {
        const text =
          (event.content as string) ||
          (event.text as string) ||
          "";
        return { type: "progress", text };
      }

      if (type === "done" || type === "complete" || type === "session.idle") {
        return {
          type: "complete",
          result: (event.result as string) ?? (event.content as string),
        };
      }

      if (type === "error" || type === "session.error") {
        const err =
          event.message ??
          event.error ??
          (event.error as { data?: { message?: string } })?.data?.message;
        return {
          type: "failed",
          text: String(err ?? "unknown"),
        };
      }

      if (type === "tool_use") {
        return { type: "log", level: "info", text: line };
      }

      return { type: "log", level: "info", text: line };
    } catch {
      return { type: "progress", text: line };
    }
  }

  static canHandle(cli: string): boolean {
    return /\bopencode\b/.test(cli);
  }
}
