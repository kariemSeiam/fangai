import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * OpenAI Codex CLI — `--json` emits JSONL events (e.g. `item.output_text`, `turn.completed`).
 *
 * Recommended wrap:
 *   fang wrap "codex --json" --port 3003
 *
 * The task text is written to stdin; ensure your Codex build reads the prompt from stdin
 * when used this way (some installs prefer a positional prompt — use shell quoting in `cli` if needed).
 */
export class CodexAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    const raw = line.trim();
    if (!raw) return null;

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { type: "progress", text: raw };
    }

    const eventType = obj.type as string;

    switch (eventType) {
      case "item.output_text": {
        const text = (obj as { text?: string }).text ?? "";
        return text ? { type: "progress", text } : null;
      }

      case "item.tool_call": {
        const name = (obj as { name?: string }).name ?? "tool";
        return { type: "log", level: "info", text: `🔧 ${name}` };
      }

      case "item.tool_result": {
        const name = (obj as { name?: string }).name ?? "tool";
        return { type: "log", level: "info", text: `✅ ${name}` };
      }

      case "turn.completed":
        return { type: "complete" };

      case "thread.started":
      case "turn.started":
        return null;

      case "error": {
        const msg = (obj as { message?: string }).message ?? "codex error";
        return { type: "failed", text: String(msg) };
      }

      default: {
        if (typeof (obj as { text?: string }).text === "string") {
          const t = (obj as { text: string }).text;
          if (t) return { type: "progress", text: t };
        }
        return { type: "log", level: "info", text: raw };
      }
    }
  }

  static canHandle(cli: string): boolean {
    return /\bcodex\b/.test(cli) && /--json\b/.test(cli);
  }
}
