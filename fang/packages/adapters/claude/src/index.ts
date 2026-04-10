import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Claude Code CLI — plain `--print` lines or NDJSON (`--output-format stream-json`).
 *
 * Recommended for streaming:
 *   claude -p --output-format stream-json --include-partial-messages
 * (flags may vary by Claude Code version; this adapter parses common shapes.)
 */
export class ClaudeAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    const raw = line.trim();
    if (!raw) return null;

    if (raw.startsWith("{")) {
      try {
        return this.parseJsonLine(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        // truncated JSON — ignore
        return null;
      }
    }

    const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
    if (!clean.trim()) return null;
    return { type: "progress", text: clean };
  }

  private parseJsonLine(o: Record<string, unknown>): TaskUpdate | null {
    const t = o.type as string | undefined;

    if (t === "result") {
      const st = (o.subtype as string) ?? "";
      if (st === "error" || o.is_error === true) {
        const msg =
          (o as { error?: string }).error ??
          JSON.stringify(o.error ?? "claude error");
        return { type: "failed", text: String(msg) };
      }
      return { type: "complete", result: "ok" };
    }

    if (t === "stream_event" && o.event && typeof o.event === "object") {
      const ev = o.event as Record<string, unknown>;
      const delta = ev.delta;
      if (delta && typeof delta === "object") {
        const d = delta as Record<string, unknown>;
        if (d.type === "text_delta" && typeof d.text === "string" && d.text) {
          return { type: "progress", text: d.text };
        }
      }
    }

    if (t === "assistant" || t === "user") {
      const msg = o.message as Record<string, unknown> | undefined;
      const content = msg?.content;
      if (Array.isArray(content)) {
        const texts = content
          .filter(
            (c): c is { type?: string; text?: string } =>
              typeof c === "object" && c !== null
          )
          .filter((c) => c.type === "text" && typeof c.text === "string")
          .map((c) => c.text as string);
        if (texts.length) return { type: "progress", text: texts.join("") };
      }
    }

    if (typeof o.text === "string" && o.text) {
      return { type: "progress", text: o.text };
    }

    return { type: "log", level: "info", text: JSON.stringify(o).slice(0, 500) };
  }

  static canHandle(cli: string): boolean {
    return /\bclaude\b/.test(cli);
  }
}
