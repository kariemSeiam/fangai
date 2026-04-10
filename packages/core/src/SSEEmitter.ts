import type { TaskUpdate } from "./index.js";

/**
 * Wraps an HTTP response into an SSE stream.
 * Each call to `send()` writes one event to the client.
 */
export class SSEEmitter {
  constructor(private readonly res: import("express").Response) {}

  send(update: TaskUpdate): void {
    if (this.res.writableEnded) return;
    this.res.write(`data: ${JSON.stringify(update)}\n\n`);
  }

  close(): void {
    if (this.res.writableEnded) return;
    this.res.write("data: [DONE]\n\n");
    this.res.end();
  }
}
