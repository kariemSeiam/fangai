/**
 * @fangai/client — minimal A2A client for talking to Fang (or any @a2a-js/sdk) servers.
 *
 * Prefer this over raw `fetch` + JSON-RPC when building orchestrators or tests.
 */

import { randomUUID } from "node:crypto";
import type { AgentCard } from "@a2a-js/sdk";

export type { AgentCard } from "@a2a-js/sdk";

function normalizeBase(url: string): string {
  return url.replace(/\/$/, "");
}

export type RunningAgent = {
  port: number;
  name: string;
  url: string;
};

const DEFAULT_PORTS = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008];

/**
 * Scan localhost ports for agents exposing `/.well-known/agent-card.json`.
 */
export async function discoverRunningAgents(
  ports: number[] = DEFAULT_PORTS,
  options?: { timeoutMs?: number }
): Promise<RunningAgent[]> {
  const timeout = options?.timeoutMs ?? 1000;
  const found: RunningAgent[] = [];

  for (const port of ports) {
    const base = `http://localhost:${port}`;
    try {
      const res = await fetch(`${base}/.well-known/agent-card.json`, {
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      const card = (await res.json()) as AgentCard;
      found.push({
        port,
        name: card.name ?? "unknown",
        url: (card as { url?: string }).url ?? base,
      });
    } catch {
      /* not listening */
    }
  }

  return found;
}

export type FangClientOptions = {
  /** Same as server `FANG_API_KEY` / `fang wrap --api-key`. */
  apiKey?: string;
};

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type JsonRpcResponse<T = unknown> = {
  jsonrpc?: string;
  id?: string;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
};

function authHeaders(apiKey?: string): Record<string, string> {
  if (!apiKey) return {};
  return { Authorization: `Bearer ${apiKey}` };
}

/**
 * POST a JSON-RPC 2.0 call to `{baseUrl}/a2a/jsonrpc` (Fang default mount).
 */
export async function callJsonRpc<T = unknown>(
  baseUrl: string,
  method: string,
  params: Record<string, unknown>,
  options?: FangClientOptions
): Promise<T> {
  const payload: JsonRpcRequest = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method,
    params,
  };

  const res = await fetch(`${normalizeBase(baseUrl)}/a2a/jsonrpc`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(options?.apiKey),
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as JsonRpcResponse<T>;
  if (!res.ok) {
    throw new Error(
      json.error?.message ?? `HTTP ${res.status} ${res.statusText}`
    );
  }
  if (json.error) {
    throw new Error(json.error.message ?? JSON.stringify(json.error));
  }
  return json.result as T;
}

/**
 * Typed client bound to one agent base URL (e.g. `http://localhost:3001`).
 */
export class FangClient {
  constructor(
    private readonly baseUrl: string,
    private readonly options?: FangClientOptions
  ) {}

  get base(): string {
    return normalizeBase(this.baseUrl);
  }

  async getAgentCard(): Promise<AgentCard> {
    const res = await fetch(`${this.base}/.well-known/agent-card.json`);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Agent card ${res.status}: ${t}`);
    }
    return res.json() as Promise<AgentCard>;
  }

  /**
   * Synchronous-style task — waits for final task/message result (`message/send`).
   */
  async sendMessage(text: string): Promise<unknown> {
    const message = {
      kind: "message" as const,
      role: "user" as const,
      messageId: randomUUID(),
      parts: [{ kind: "text" as const, text }],
    };
    return callJsonRpc(this.base, "message/send", { message }, this.options);
  }

  /**
   * Start SSE streaming (`message/stream`). Returns the `fetch` `Response` so you can read `body` (see Fang CLI `send` for parsing).
   */
  async streamMessage(text: string): Promise<Response> {
    const message = {
      kind: "message" as const,
      role: "user" as const,
      messageId: randomUUID(),
      parts: [{ kind: "text" as const, text }],
    };
    const payload: JsonRpcRequest = {
      jsonrpc: "2.0",
      id: randomUUID(),
      method: "message/stream",
      params: { message },
    };

    return fetch(`${this.base}/a2a/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(this.options?.apiKey),
      },
      body: JSON.stringify(payload),
    });
  }
}
