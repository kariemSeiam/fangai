import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { FangServer } from "../FangServer.js";
import { BaseAdapter, type FangConfig, type Task, type TaskUpdate } from "../index.js";

/**
 * HTTP contract: real Express stack + @a2a-js/sdk JSON-RPC (no fetch mocks).
 */
class StubAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    return task.message;
  }
  parseOutput(): TaskUpdate | null {
    return null;
  }
}

describe("Fang HTTP contract", () => {
  let server: FangServer;
  let base: string;

  beforeAll(async () => {
    const config: FangConfig = {
      cli: "node",
      args: ["-e", "process.exit(0)"],
      port: 0,
      host: "127.0.0.1",
      name: "contract-agent",
      costTier: "cheap",
      specializations: ["code"],
      timeout: 30,
    };
    server = new FangServer(config, new StubAdapter());
    await server.start();
    const port = server.listeningPort();
    base = `http://127.0.0.1:${port}`;
  }, 15_000);

  afterAll(async () => {
    await server.stop();
  });

  it("GET /health exposes bridge fang", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.ok).toBe(true);
    const j = (await res.json()) as { bridge?: string; auth?: string };
    expect(j.bridge).toBe("fang");
    expect(j.auth).toBe("none");
  });

  it("GET /.well-known/agent-card.json returns JSON with name", async () => {
    const res = await fetch(`${base}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as { name?: string };
    expect(card.name).toBe("contract-agent");
  });

  it("POST /a2a/jsonrpc returns JSON-RPC error for unknown method", async () => {
    const res = await fetch(`${base}/a2a/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rpc-unknown",
        method: "fang/unknownMethod",
        params: { _: true },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      jsonrpc?: string;
      id?: string;
      error?: { code?: number; message?: string };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("rpc-unknown");
    expect(body.error).toBeDefined();
    expect(body.error?.message).toMatch(/not found|Method/i);
  });

  it("POST /a2a/jsonrpc tasks/get returns JSON-RPC error when task is missing", async () => {
    const res = await fetch(`${base}/a2a/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rpc-get-missing",
        method: "tasks/get",
        params: { id: "00000000-0000-0000-0000-000000000001" },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      jsonrpc?: string;
      id?: string;
      error?: { code?: number; message?: string };
    };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("rpc-get-missing");
    expect(body.error).toBeDefined();
    expect(body.error?.message).toMatch(/not found|Task/i);
  });
});

describe("Fang HTTP contract (API key)", () => {
  let server: FangServer;
  let base: string;
  const apiKey = "contract-test-api-key";

  beforeAll(async () => {
    const config: FangConfig = {
      cli: "node",
      args: ["-e", "process.exit(0)"],
      port: 0,
      host: "127.0.0.1",
      name: "keyed-agent",
      costTier: "cheap",
      specializations: ["code"],
      timeout: 30,
      apiKey,
    };
    server = new FangServer(config, new StubAdapter());
    await server.start();
    base = `http://127.0.0.1:${server.listeningPort()}`;
  }, 15_000);

  afterAll(async () => {
    await server.stop();
  });

  it("GET /health reports auth api-key", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.ok).toBe(true);
    const j = (await res.json()) as { auth?: string };
    expect(j.auth).toBe("api-key");
  });

  it("GET /.well-known/agent-card.json stays public without key", async () => {
    const res = await fetch(`${base}/.well-known/agent-card.json`);
    expect(res.ok).toBe(true);
    const card = (await res.json()) as { name?: string };
    expect(card.name).toBe("keyed-agent");
  });

  it("POST /a2a/jsonrpc without credentials returns 401", async () => {
    const res = await fetch(`${base}/a2a/jsonrpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "n",
        method: "tasks/get",
        params: { id: "00000000-0000-0000-0000-000000000002" },
      }),
    });
    expect(res.status).toBe(401);
    const j = (await res.json()) as { error?: string };
    expect(j.error).toBe("Unauthorized");
  });

  it("POST /a2a/jsonrpc with X-Api-Key reaches JSON-RPC", async () => {
    const res = await fetch(`${base}/a2a/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rpc-x-key",
        method: "fang/unknownMethod",
        params: { _: true },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { jsonrpc?: string; error?: { message?: string } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error?.message).toMatch(/not found|Method/i);
  });

  it("POST /a2a/jsonrpc with Authorization Bearer reaches JSON-RPC", async () => {
    const res = await fetch(`${base}/a2a/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "rpc-bearer",
        method: "fang/unknownMethod",
        params: { _: true },
      }),
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { jsonrpc?: string; error?: { message?: string } };
    expect(body.jsonrpc).toBe("2.0");
    expect(body.error?.message).toMatch(/not found|Method/i);
  });
});
