/**
 * In-memory A2A TaskStore — bounded LRU + TTL cleanup for completed terminal tasks.
 * Matches @a2a-js/sdk TaskStore: save/load only.
 */

import type { Task } from '@a2a-js/sdk';
import type { TaskStore, ServerCallContext } from '@a2a-js/sdk/server';

const TERMINAL_STATES = new Set<string>([
  'completed',
  'failed',
  'canceled',
  'rejected',
]);

interface StoredEntry {
  task: Task;
  /** Timestamp when task first entered a terminal status (milliseconds). Null if active. */
  terminalSinceMs: number | null;
}

function shallowCloneTask(task: Task): Task {
  const t: Task = { ...task };
  if (t.history !== undefined) {
    t.history = [...t.history];
  }
  if (t.artifacts !== undefined) {
    t.artifacts = t.artifacts.map(a => ({ ...a }));
  }
  return t;
}

export interface FangTaskStoreOptions {
  /** Maximum tasks retained (LRU eviction). Default 100. */
  maxTasks?: number;
  /** Drop terminal tasks untouched longer than this many minutes. Default 60. */
  completedRetentionMinutes?: number;
}

export class FangTaskStore implements TaskStore {
  private readonly maxTasks: number;
  private readonly retentionMs: number;
  /** Map iteration order == LRU (touch = delete + re-append). */
  private readonly entries = new Map<string, StoredEntry>();

  constructor(options?: FangTaskStoreOptions) {
    const mt = options && options.maxTasks !== undefined ? options.maxTasks : 100;
    this.maxTasks = mt < 1 ? 1 : mt;
    const mins = options && options.completedRetentionMinutes !== undefined
      ? options.completedRetentionMinutes
      : 60;
    this.retentionMs = Math.max(1, mins) * 60 * 1000;
  }

  async save(task: Task, _context?: ServerCallContext): Promise<void> {
    const cloned = shallowCloneTask(task);
    const now = Date.now();
    const terminal = TERMINAL_STATES.has(cloned.status.state);

    let terminalSinceMs: number | null = null;
    if (terminal) {
      const prev = this.entries.get(cloned.id);
      if (prev && prev.terminalSinceMs !== null && TERMINAL_STATES.has(prev.task.status.state)) {
        terminalSinceMs = prev.terminalSinceMs;
      } else {
        terminalSinceMs = now;
      }
    }

    if (this.entries.has(cloned.id)) {
      this.entries.delete(cloned.id);
    }
    this.entries.set(cloned.id, { task: cloned, terminalSinceMs });

    this.evictIfNeeded();
    return Promise.resolve();
  }

  async load(taskId: string, _context?: ServerCallContext): Promise<Task | undefined> {
    const wrap = this.entries.get(taskId);
    if (!wrap) {
      return Promise.resolve(undefined);
    }
    this.entries.delete(taskId);
    const entry: StoredEntry = {
      task: wrap.task,
      terminalSinceMs: wrap.terminalSinceMs,
    };
    this.entries.set(taskId, entry);
    return Promise.resolve(shallowCloneTask(entry.task));
  }

  /** Remove one task ID (Fang extension — not part of SDK TaskStore). */
  delete(taskId: string, _context?: ServerCallContext): Promise<void> {
    this.entries.delete(taskId);
    return Promise.resolve();
  }

  /**
   * Drops terminal tasks whose `terminalSinceMs` is older than the retention window.
   */
  cleanupStaleCompleted(): void {
    const now = Date.now();
    for (const [id, ent] of this.entries) {
      if (
        TERMINAL_STATES.has(ent.task.status.state) &&
        ent.terminalSinceMs !== null &&
        now - ent.terminalSinceMs > this.retentionMs
      ) {
        this.entries.delete(id);
      }
    }
  }

  private evictIfNeeded(): void {
    while (this.entries.size > this.maxTasks) {
      let victim: string | undefined;
      for (const id of this.entries.keys()) {
        const ent = this.entries.get(id);
        if (ent && TERMINAL_STATES.has(ent.task.status.state)) {
          victim = id;
          break;
        }
      }
      if (victim === undefined) {
        victim = this.entries.keys().next().value as string | undefined;
      }
      if (victim === undefined) {
        break;
      }
      this.entries.delete(victim);
    }
  }
}
