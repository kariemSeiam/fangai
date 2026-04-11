/**
 * @fangai/core — types, adapter interface, process manager, detector
 *
 * Uses LF-only JSONL reader (not Node readline) for protocol compliance.
 * Pi's RPC protocol explicitly requires splitting on \n only — readline
 * also splits on U+2028 and U+2029 which are valid inside JSON strings.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ─── Types ────────────────────────────────────────────────────────────────

export interface AgentTask {
  id: string;
  message: string;
  context?: { workdir?: string; files?: string[]; metadata?: Record<string, unknown> };
}

export interface DetectionResult {
  binary: string;
  version: string;
  path: string;
  tier: 1 | 2 | 3;
  protocol: string;
}

export type AdapterEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; tool: string; input?: Record<string, unknown> }
  | { type: 'tool-result'; tool: string; output: string; isError?: boolean }
  | { type: 'thinking'; text: string }
  | { type: 'status'; state: 'working' | 'completed' | 'failed' | 'input-required' }
  | { type: 'error'; message: string; code?: string };

export interface AgentAdapter {
  readonly id: string;
  readonly binary: string;
  readonly tier: 1 | 2 | 3;
  readonly displayName: string;
  readonly mode: 'oneshot' | 'persistent';
  skills: Array<{ id: string; name: string; tags: string[] }>;

  buildArgs(task: AgentTask, config: FangConfig): string[];
  formatInput(task: AgentTask): string;
  parseLine(line: string): AdapterEvent[];
  detect(): Promise<DetectionResult | null>;
  dispose?(): Promise<void>;
}

export interface FangConfig {
  cli: string;
  port: number;
  name?: string;
  workdir?: string;
  env?: Record<string, string>;
  maxConcurrent?: number;
  taskTimeout?: number;
  killTimeout?: number;
  agentFlags?: string[];
  apiKey?: string;
  cors?: boolean;
}

// ─── LF-only JSONL reader ─────────────────────────────────────────────────
// Strict JSONL framing: split on \n only. Does NOT use Node readline,
// which incorrectly splits on U+2028 and U+2029 (valid in JSON strings).
// Based on Pi's own attachJsonlLineReader implementation.

export function attachJsonlReader(stream: NodeJS.ReadableStream, onLine: (line: string) => void): () => void {
  let buffer = '';

  const onData = (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      // Strip optional \r (accept \r\n input)
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.length > 0) onLine(line);
    }
  };

  const onEnd = () => {
    if (buffer.length > 0) {
      let remaining = buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer;
      if (remaining.length > 0) onLine(remaining);
      buffer = '';
    }
  };

  stream.on('data', onData);
  stream.on('end', onEnd);

  // Return cleanup function
  return () => {
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
  };
}

// ─── Process Manager ──────────────────────────────────────────────────────

export class ProcessManager {
  private processes = new Map<string, ChildProcess>();
  private killTimers = new Map<string, NodeJS.Timeout>();
  private cleanups = new Map<string, () => void>();

  spawn(
    taskId: string,
    cmd: string,
    args: string[],
    opts: { cwd?: string; env?: Record<string, string> },
    handlers: {
      onLine: (line: string) => void;
      onError: (text: string) => void;
      onExit: (code: number | null, signal: string | null) => void;
    },
  ): ChildProcess {
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.cwd,
      env: { ...process.env as Record<string, string>, ...opts.env },
    });
    this.processes.set(taskId, proc);

    // LF-only JSONL reader — protocol compliant
    const detach = attachJsonlReader(proc.stdout!, handlers.onLine);
    this.cleanups.set(taskId, detach);

    let stderrBuf = '';
    proc.stderr!.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
      const lines = stderrBuf.split('\n');
      stderrBuf = lines.pop()!;
      for (const line of lines) {
        if (line.trim()) handlers.onError(line);
      }
    });

    proc.on('exit', (code, signal) => {
      detach();
      this.processes.delete(taskId);
      this.cleanups.delete(taskId);
      const timer = this.killTimers.get(taskId);
      if (timer) { clearTimeout(timer); this.killTimers.delete(taskId); }
      handlers.onExit(code, signal);
    });

    proc.on('error', (err) => {
      detach();
      this.processes.delete(taskId);
      this.cleanups.delete(taskId);
      handlers.onError(err.message);
      handlers.onExit(1, null);
    });

    return proc;
  }

  stdin(taskId: string, data: string, close = false): void {
    const proc = this.processes.get(taskId);
    if (!proc) return;
    proc.stdin!.write(data);
    if (close) proc.stdin!.end();
  }

  kill(taskId: string, timeout = 5000): void {
    const proc = this.processes.get(taskId);
    if (!proc) return;
    proc.kill('SIGTERM');
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
    }, timeout);
    this.killTimers.set(taskId, timer);
  }

  killAll(timeout = 5000): void {
    for (const id of this.processes.keys()) this.kill(id, timeout);
  }

  has(taskId: string): boolean { return this.processes.has(taskId); }
  get(taskId: string): ChildProcess | undefined { return this.processes.get(taskId); }
}

// ─── Persistent Process Manager ───────────────────────────────────────────
// Supports multiple concurrent tasks via per-task line handlers.
// Lines are routed to the active task. When a task completes (status event),
// the next queued task becomes active.
//
// Also handles Pi's extension UI dialog protocol: auto-responds to
// select/confirm/input/editor requests so the agent doesn't hang.

export class PersistentProcess {
  private proc: ChildProcess | null = null;
  private detachReader: (() => void) | null = null;
  private readonly cmd: string;
  private readonly args: string[];
  private readonly opts: { cwd?: string; env?: Record<string, string> };

  /** Map of taskId → line handler. Only the active task receives lines. */
  private taskHandlers = new Map<string, (line: string) => void>();
  /** Ordered queue of task IDs waiting to be active. */
  private taskQueue: string[] = [];
  /** The currently active task ID (receiving stdout lines). */
  private activeTaskId: string | null = null;

  constructor(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> }) {
    this.cmd = cmd;
    this.args = args;
    this.opts = opts;
  }

  /**
   * Register a handler for a task. The handler will receive stdout lines
   * when this task becomes active.
   */
  setLineHandler(taskId: string, handler: (line: string) => void): void {
    this.taskHandlers.set(taskId, handler);
    // If this is the first task and nothing is active, activate immediately
    if (!this.activeTaskId && this.taskQueue.length === 0) {
      this.activeTaskId = taskId;
      this.taskQueue.push(taskId);
    } else {
      this.taskQueue.push(taskId);
    }
  }

  /** Remove a task's handler (e.g., after completion). */
  removeLineHandler(taskId: string): void {
    this.taskHandlers.delete(taskId);
    this.taskQueue = this.taskQueue.filter(id => id !== taskId);
    if (this.activeTaskId === taskId) {
      this.activeTaskId = null;
      // Activate next task in queue
      this.advanceQueue();
    }
  }

  private advanceQueue(): void {
    if (this.activeTaskId) return;
    while (this.taskQueue.length > 0) {
      const next = this.taskQueue[0];
      if (this.taskHandlers.has(next)) {
        this.activeTaskId = next;
        return;
      }
      // Handler was removed but task still in queue — skip
      this.taskQueue.shift();
    }
  }

  async ensure(): Promise<void> {
    if (this.proc && this.proc.exitCode === null) return; // still alive

    this.proc = spawn(this.cmd, this.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: this.opts.cwd,
      env: { ...process.env as Record<string, string>, ...this.opts.env },
    });

    // LF-only JSONL reader — protocol compliant
    this.detachReader = attachJsonlReader(this.proc.stdout!, (line) => {
      // Handle Pi's extension UI dialog protocol — auto-respond to unblock agent
      this.handleExtensionUI(line);

      // Route line to the active task's handler
      if (this.activeTaskId) {
        const handler = this.taskHandlers.get(this.activeTaskId);
        if (handler) handler(line);
      }
    });

    this.proc.stderr!.on('data', (_chunk: Buffer) => {
      // stderr from persistent process — log but don't fail
    });

    this.proc.on('exit', () => {
      if (this.detachReader) { this.detachReader(); this.detachReader = null; }
      this.proc = null;
      this.activeTaskId = null;
    });

    await new Promise<void>((resolve) => {
      this.proc!.once('spawn', () => resolve());
      this.proc!.once('error', () => { this.proc = null; resolve(); });
    });
  }

  /**
   * Auto-respond to Pi extension UI dialog requests.
   *
   * Pi extensions can call ctx.ui.select(), confirm(), input(), editor() —
   * these emit extension_ui_request on stdout and block until we send
   * extension_ui_response on stdin. Without a response, the agent hangs.
   *
   * Fire-and-forget methods (notify, setStatus, setWidget, setTitle,
   * set_editor_text) don't need a response — correctly ignored.
   */
  private handleExtensionUI(line: string): void {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }

    if (e.type !== 'extension_ui_request') return;

    const dialogMethods = new Set(['select', 'confirm', 'input', 'editor']);
    if (!dialogMethods.has(e.method)) return;

    // Auto-respond with safe defaults to unblock the agent
    let response: any;
    if (e.method === 'confirm') {
      response = { type: 'extension_ui_response', id: e.id, confirmed: false };
    } else if (e.method === 'select') {
      // Cancel — extension receives undefined
      response = { type: 'extension_ui_response', id: e.id, cancelled: true };
    } else {
      // input/editor — cancel
      response = { type: 'extension_ui_response', id: e.id, cancelled: true };
    }

    this.write(JSON.stringify(response) + '\n');
  }

  write(data: string): void {
    if (!this.proc) return;
    this.proc.stdin!.write(data);
  }

  async kill(): Promise<void> {
    if (this.proc) {
      if (this.detachReader) { this.detachReader(); this.detachReader = null; }
      this.proc.kill('SIGTERM');
      this.proc = null;
      this.activeTaskId = null;
    }
  }

  get isAlive(): boolean { return this.proc !== null && this.proc.exitCode === null; }
}

// ─── Detector ─────────────────────────────────────────────────────────────

export async function detectAdapters(adapters: AgentAdapter[]): Promise<Array<{ adapter: AgentAdapter; detection: DetectionResult }>> {
  const results: Array<{ adapter: AgentAdapter; detection: DetectionResult }> = [];
  for (const adapter of adapters) {
    try {
      const detection = await adapter.detect();
      if (detection) results.push({ adapter, detection });
    } catch { /* not installed */ }
  }
  return results.sort((a, b) => a.adapter.tier - b.adapter.tier);
}