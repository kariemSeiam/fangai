// ─── Types ──────────────────────────────────────────────────────────────────

/** An incoming A2A task */
export interface Task {
  id: string;
  message: string;
}

/** Task update streamed to SSE clients */
export type TaskUpdate =
  | { type: "progress"; text: string }
  | { type: "complete"; result?: string }
  | { type: "failed"; text: string }
  | { type: "log"; level: "info" | "error"; text: string };

/** Task lifecycle state */
export type TaskStatus = "submitted" | "running" | "completed" | "failed";

/** A task with full state */
export interface TaskState {
  id: string;
  status: TaskStatus;
  message: string;
  updates: TaskUpdate[];
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

/** Agent Card — A2A discovery document */
export interface AgentCard {
  name: string;
  version: string;
  url: string;
  description?: string;
  capabilities: {
    streaming: boolean;
    async: boolean;
    parallel_tasks: number;
  };
  skills: Array<{
    id: string;
    name: string;
    tags: string[];
  }>;
  metadata: Record<string, unknown>;
}

/** Configuration for a FangServer instance */
export interface FangConfig {
  cli: string;
  args?: string[];
  port: number;
  /**
   * When set, HTTP server binds only to this address (e.g. `127.0.0.1`).
   * When omitted, Express uses the default (often all interfaces — see security spec).
   */
  host?: string;
  name: string;
  model?: string;
  costTier: "free" | "cheap" | "paid" | "best";
  specializations: string[];
  maxParallel?: number;
  timeout?: number;
  /**
   * When set, send tasks to a running `opencode serve` via `@opencode-ai/sdk` instead of
   * spawning `cli`. Use with a CLI string that matches the OpenCode adapter (e.g. `opencode`).
   */
  openCodeServeUrl?: string;
  /** Basic-auth password for the OpenCode server (username `opencode`). */
  openCodeServePassword?: string;
  /** Optional `x-opencode-directory` workspace for the SDK. */
  openCodeDirectory?: string;
  /**
   * When set (or `FANG_API_KEY` in the environment), JSON-RPC `/a2a` and A2A REST `/v1/*`
   * require `Authorization: Bearer <key>` or `X-Api-Key: <key>`. Agent card and `/health` stay public.
   */
  apiKey?: string;
}

// ─── Adapter Contract ───────────────────────────────────────────────────────

/** Base adapter — translates between A2A and CLI-specific formats */
export abstract class BaseAdapter {
  /**
   * `persistent` — one long-lived subprocess (e.g. Pi `--mode rpc`).
   * `oneshot` — spawn per task (default).
   */
  get executionMode(): "oneshot" | "persistent" {
    return "oneshot";
  }

  /** Format an A2A task into CLI stdin input */
  abstract formatInput(task: Task): string;

  /** Parse a line of CLI stdout into a task update */
  abstract parseOutput(line: string): TaskUpdate | null;

  /** Auto-detection: should this adapter handle the given CLI command? */
  static canHandle(_cli: string): boolean {
    void _cli;
    return false;
  }
}

// ─── Exports ────────────────────────────────────────────────────────────────

export { FangServer } from "./FangServer.js";
export { FangAgentExecutor } from "./FangAgentExecutor.js";
export { buildSdkAgentCard } from "./sdkAgentCard.js";
export { TaskManager } from "./TaskManager.js";
export { SSEEmitter } from "./SSEEmitter.js";
export { buildAgentCard } from "./AgentCard.js";
export { detectAdapter } from "./AdapterRegistry.js";
export {
  detectHostAgents,
  type HostAgentInfo,
} from "./hostDetect.js";
export {
  apiKeyGate,
  extractApiKeyFromRequest,
} from "./apiKeyGate.js";
