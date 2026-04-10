/**
 * Real OpenCode CLI + `@opencode-ai/sdk` against a local `opencode serve` process.
 *
 * Not run in CI by default (requires the `opencode` binary). Enable locally:
 *
 *   set RUN_OPENCODE_INTEGRATION=1   (Windows)
 *   RUN_OPENCODE_INTEGRATION=1 pnpm --filter @fangai/core exec vitest run src/__tests__/opencode.serve.integration.test.ts
 */
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import which from "which";
import { createOpencodeClient } from "@opencode-ai/sdk/v2";

const RUN = process.env.RUN_OPENCODE_INTEGRATION === "1";

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

async function waitForHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: Error | undefined;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { headers });
      if (r.ok) return;
    } catch (e) {
      last = e instanceof Error ? e : new Error(String(e));
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw last ?? new Error("timeout waiting for OpenCode serve");
}

describe.skipIf(!RUN)("OpenCode serve — integration (real binary)", () => {
  let proc: ChildProcess | undefined;
  let port: number;
  const password = "fang-test-opencode-serve";

  beforeAll(async () => {
    port = await findFreePort();
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;

    const serveArgs = ["serve", "--hostname", "127.0.0.1", "--port", String(port)];

    if (process.platform === "win32") {
      // Windows: npm shims are `.cmd` — spawn via `cmd /c` to avoid spawn EINVAL on `.cmd` files.
      proc = spawn(process.env.ComSpec ?? "cmd.exe", ["/c", "opencode", ...serveArgs], {
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
        stdio: "ignore",
        windowsHide: true,
      });
    } else {
      let executable: string;
      try {
        executable = await which("opencode");
      } catch {
        throw new Error(
          "opencode not on PATH — install OpenCode CLI to run this integration test"
        );
      }
      proc = spawn(executable, serveArgs, {
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: password },
        stdio: "ignore",
      });
    }

    await waitForHttp(
      `http://127.0.0.1:${port}/session`,
      { Authorization: auth },
      45_000
    );
  }, 60_000);

  afterAll(() => {
    if (proc && !proc.killed) {
      proc.kill("SIGTERM");
    }
  });

  it("session.list via SDK matches HTTP (empty array on fresh serve)", async () => {
    const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
    const httpRes = await fetch(`http://127.0.0.1:${port}/session`, {
      headers: { Authorization: auth },
    });
    expect(httpRes.ok).toBe(true);
    const httpJson = (await httpRes.json()) as unknown;
    expect(Array.isArray(httpJson)).toBe(true);

    const sdk = createOpencodeClient({
      baseUrl: `http://127.0.0.1:${port}`,
      headers: { Authorization: auth },
    });
    const listed = await sdk.session.list();
    expect(listed.data).toEqual(httpJson);
  });

});
