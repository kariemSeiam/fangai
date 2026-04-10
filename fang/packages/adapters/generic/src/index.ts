import { BaseAdapter, type Task, type TaskUpdate } from "@fangai/core";

/**
 * Generic adapter — the fallback for any CLI that reads stdin and writes stdout.
 *
 * Every non-empty stdout line becomes a progress update.
 * Process exit code 0 = complete, non-zero = failed.
 * This adapter always matches (canHandle returns true), so it must be
 * registered LAST in the adapter registry.
 */
export class GenericAdapter extends BaseAdapter {
  private lastLine = "";

  formatInput(task: Task): string {
    return task.message + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
    if (!clean) return null;
    this.lastLine = clean;
    return { type: "progress", text: clean };
  }

  static canHandle(_cli: string): boolean {
    return true; // always matches — must be last in registry
  }
}
