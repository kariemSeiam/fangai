import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Cursor Agent CLI — `cursor-agent --print --output-format stream-json`.
 *
 * Event shapes (stream-json, one JSON object per line):
 *   { "type": "system", ... }
 *   { "type": "user", ... }
 *   { "type": "assistant", "content": "...", "session_id": "..." }
 *   { "type": "tool_call_started", "tool": { "name": "shell|edit|read|...", ... } }
 *   { "type": "tool_call_completed", "tool": { "name": "...", ... }, "output": "..." }
 *   { "type": "result", "content": "...", "session_id": "..." }
 *
 * Multi-turn via `--continue` (resume last session) or `--resume <chatId>`.
 * Model selection via `--model <id>`.
 * Worktree isolation via `--worktree`.
 *
 * Usage:
 *   fang wrap "cursor-agent --print --output-format stream-json --stream-partial-output --yolo --trust" --port 3003
 */
export class CursorAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    const raw = line.trim();
    if (!raw) return null;

    // Try JSON first — cursor-agent emits stream-json lines
    if (raw.startsWith("{")) {
      try {
        return this.parseJsonLine(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // Truncated JSON — emit as log and move on
        return { type: "log", level: "info", text: raw.slice(0, 200) };
      }
    }

    // Fallback: plain text (e.g. --print without stream-json)
    const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
    if (!clean.trim()) return null;
    return { type: "progress", text: clean };
  }

  private parseJsonLine(o: Record<string, unknown>): TaskUpdate | null {
    const type = o.type as string | undefined;

    // ── Result: task finished ─────────────────────────────────────────
    if (type === "result") {
      if (o.error === true || o.is_error === true) {
        const msg =
          (o.content as string | undefined) ??
          (typeof o.error === "string" ? o.error : null) ??
          "cursor-agent error";
        return { type: "failed", text: String(msg) };
      }
      const content = o.content as string | undefined;
      return {
        type: "complete",
        result: content ?? "ok",
      };
    }

    // ── Assistant: streaming text output ──────────────────────────────
    if (type === "assistant") {
      const content = o.content as string | undefined;
      if (content && content.trim()) {
        return { type: "progress", text: content };
      }
      return null;
    }

    // ── Tool call started: agent is working ───────────────────────────
    if (type === "tool_call_started") {
      const tool = o.tool as Record<string, unknown> | undefined;
      const name = (tool?.name as string) ?? "unknown";
      return {
        type: "log",
        level: "info",
        text: `🔧 → ${name}`,
      };
    }

    // ── Tool call completed: result available ─────────────────────────
    if (type === "tool_call_completed") {
      const tool = o.tool as Record<string, unknown> | undefined;
      const name = (tool?.name as string) ?? "unknown";
      const output = o.output as string | undefined;
      const summary = output
        ? ` (${output.length > 80 ? output.slice(0, 77) + "..." : output})`
        : "";
      return {
        type: "log",
        level: "info",
        text: `✅ ← ${name}${summary}`,
      };
    }

    // ── System: metadata, skip noise ──────────────────────────────────
    if (type === "system") {
      return null;
    }

    // ── User echo: skip ───────────────────────────────────────────────
    if (type === "user") {
      return null;
    }

    // ── Unknown event: forward as log ─────────────────────────────────
    return { type: "log", level: "info", text: JSON.stringify(o).slice(0, 500) };
  }

  static canHandle(cli: string): boolean {
    return /\bcursor-agent\b/.test(cli);
  }
}
