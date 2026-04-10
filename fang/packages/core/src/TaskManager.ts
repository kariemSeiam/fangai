import type { TaskState, TaskUpdate } from "./index.js";
import { SSEEmitter } from "./SSEEmitter.js";

const DEFAULT_TTL = 60_000; // 1 minute cleanup after completion

/**
 * Manages task lifecycle and SSE subscriber notification.
 * All state is in-memory — tasks are garbage collected after TTL.
 */
export class TaskManager {
  private tasks = new Map<string, TaskState>();
  private subscribers = new Map<string, Set<SSEEmitter>>();

  create(id: string, message: string): TaskState {
    const task: TaskState = {
      id,
      status: "submitted",
      message,
      updates: [],
      createdAt: Date.now(),
    };
    this.tasks.set(id, task);
    return task;
  }

  update(id: string, update: TaskUpdate): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (task.status === "submitted") task.status = "running";
    task.updates.push(update);
    this.emit(id, update);
  }

  complete(id: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = "completed";
    task.completedAt = Date.now();
    // Aggregate result from all progress updates
    task.result = task.updates
      .filter((u) => u.type === "progress")
      .map((u) => ("text" in u ? u.text : ""))
      .join("")
      .trim();
    this.emit(id, { type: "complete", result: task.result });
    this.scheduleCleanup(id);
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id);
    if (!task) return;
    task.status = "failed";
    task.error = error;
    task.completedAt = Date.now();
    this.emit(id, { type: "failed", text: error });
    this.scheduleCleanup(id);
  }

  get(id: string): TaskState | undefined {
    return this.tasks.get(id);
  }

  subscribe(id: string, emitter: SSEEmitter): void {
    if (!this.subscribers.has(id)) this.subscribers.set(id, new Set());
    this.subscribers.get(id)!.add(emitter);
  }

  unsubscribe(id: string, emitter: SSEEmitter): void {
    this.subscribers.get(id)?.delete(emitter);
  }

  private emit(id: string, update: TaskUpdate): void {
    const subs = this.subscribers.get(id);
    if (!subs) return;
    for (const emitter of subs) {
      emitter.send(update);
    }
  }

  private scheduleCleanup(id: string, delay = DEFAULT_TTL): void {
    setTimeout(() => {
      this.tasks.delete(id);
      this.subscribers.delete(id);
    }, delay);
  }
}
