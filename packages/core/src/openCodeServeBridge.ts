import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import type { Event } from "@opencode-ai/sdk/v2/client";
import type { BaseAdapter, TaskUpdate } from "./index.js";

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function unwrapEvent(raw: unknown): Event | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if ("payload" in o && o.payload && typeof o.payload === "object") {
    return o.payload as Event;
  }
  return raw as Event;
}

function authHeader(password: string | undefined): Record<string, string> | undefined {
  if (!password) return undefined;
  const token = Buffer.from(`opencode:${password}`).toString("base64");
  return { Authorization: `Basic ${token}` };
}

/** Map SSE sync events to stdout-shaped JSON for {@link BaseAdapter#parseOutput}. */
export function openCodeEventToAdapterLine(
  ev: Event,
  sessionID: string
): string | null {
  if (ev.type === "message.part.updated") {
    const { part } = ev.properties;
    if (part.sessionID !== sessionID) return null;
    if (part.type === "text" && part.time?.end) {
      return JSON.stringify({
        type: "text",
        timestamp: Date.now(),
        sessionID,
        part,
      });
    }
  }
  if (ev.type === "session.error") {
    const sid = ev.properties.sessionID;
    if (sid !== undefined && sid !== sessionID) return null;
    return JSON.stringify({
      type: "error",
      timestamp: Date.now(),
      sessionID,
      error: ev.properties.error,
    });
  }
  return null;
}

function isIdle(ev: Event, sessionID: string): boolean {
  if (ev.type === "session.status") {
    return (
      ev.properties.sessionID === sessionID && ev.properties.status.type === "idle"
    );
  }
  if (ev.type === "session.idle") {
    return ev.properties.sessionID === sessionID;
  }
  return false;
}

/**
 * Run one A2A user turn against a running `opencode serve` instance via `@opencode-ai/sdk`.
 */
export async function runOpenCodeServeTurn(options: {
  baseUrl: string;
  password?: string;
  directory?: string;
  text: string;
  adapter: BaseAdapter;
  timeoutSec: number;
  onUpdate: (u: TaskUpdate | null) => void;
}): Promise<void> {
  const sdk = createOpencodeClient({
    baseUrl: normalizeBaseUrl(options.baseUrl),
    headers: authHeader(options.password),
    ...(options.directory ? { directory: options.directory } : {}),
  });

  const sse = await sdk.event.subscribe();
  const cleanup = () => { try { sse.stream.return(undefined as any); } catch { /* ignore */ } };
  const created = await sdk.session.create({
    title: `fang-${Date.now()}`,
  });
  const sessionID = created.data?.id;
  if (!sessionID) {
    cleanup();
    options.onUpdate({
      type: "failed",
      text: "OpenCode session.create returned no session id",
    });
    return;
  }

  const timeoutMs = options.timeoutSec * 1000;
  let streamOutcome: "idle" | "error" | undefined;

  const consumeStream = async (): Promise<void> => {
    for await (const raw of sse.stream) {
      const ev = unwrapEvent(raw);
      if (!ev) continue;

      if (ev.type === "permission.asked") {
        const p = ev.properties;
        if (p.sessionID === sessionID) {
          await sdk.permission.reply({
            requestID: p.id,
            reply: "reject",
          });
        }
        continue;
      }

      const line = openCodeEventToAdapterLine(ev, sessionID);
      if (line) {
        options.onUpdate(options.adapter.parseOutput(line));
      }

      if (isIdle(ev, sessionID)) {
        streamOutcome = "idle";
        options.onUpdate({ type: "complete" });
        return;
      }

      if (ev.type === "session.error") {
        const sid = ev.properties.sessionID;
        if (sid !== undefined && sid !== sessionID) continue;
        streamOutcome = "error";
        const err = ev.properties.error;
        const msg =
          err && typeof err === "object" && "name" in err
            ? String((err as { name?: string }).name)
            : "session.error";
        options.onUpdate({ type: "failed", text: msg });
        return;
      }
    }
  };

  const streamPromise = consumeStream();

  await sdk.session.prompt({
    sessionID,
    parts: [{ type: "text", text: options.text }],
  });

  await Promise.race([
    streamPromise,
    new Promise<void>((_, reject) =>
      setTimeout(
        () => reject(new Error(`OpenCode task timed out after ${options.timeoutSec}s`)),
        timeoutMs
      )
    ),
  ]).catch((e) => {
    cleanup();
    if (!streamOutcome) {
      options.onUpdate({
        type: "failed",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  });

  cleanup();
}
