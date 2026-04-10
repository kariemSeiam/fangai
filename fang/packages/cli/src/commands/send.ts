import { Command } from "commander";
import { FangClient } from "@fangai/client";

/**
 * JSON-RPC to Fang's /a2a endpoint (@a2a-js/sdk).
 */
export const sendCommand = new Command("send")
  .description("Send a task to a running Fang agent (JSON-RPC message/send or message/stream)")
  .argument("<task>", "Task description")
  .option("-p, --port <n>", "Target agent port", "3001")
  .option("--url <url>", "Full agent base URL (overrides --port), e.g. http://localhost:3001")
  .option("--stream", "Use message/stream (SSE)", true)
  .option("--no-stream", "Use message/send (wait for final result)")
  .option(
    "--api-key <secret>",
    "Bearer token for secured agents (or FANG_API_KEY)"
  )
  .action(
    async (
      task: string,
      options: {
        port: string;
        url?: string;
        stream: boolean;
        apiKey?: string;
      }
    ) => {
    const baseUrl = (options.url ?? `http://localhost:${options.port}`).replace(
      /\/$/,
      ""
    );

    const apiKey =
      options.apiKey?.trim() || process.env.FANG_API_KEY?.trim() || undefined;
    const client = new FangClient(baseUrl, apiKey ? { apiKey } : undefined);

    if (!options.stream) {
      try {
        const result = await client.sendMessage(task);
        console.log(JSON.stringify(result, null, 2));
      } catch (e) {
        console.error(
          `❌ ${e instanceof Error ? e.message : String(e)}`
        );
        process.exit(1);
      }
      return;
    }

    let res: Response;
    try {
      res = await client.streamMessage(task);
    } catch {
      console.error(`❌ Cannot connect to ${baseUrl}`);
      console.error(`   Is the agent running? Try: fang discover`);
      process.exit(1);
    }

    if (!res.ok) {
      const t = await res.text();
      console.error(`❌ ${res.status} ${res.statusText}`, t);
      process.exit(1);
    }

    if (!res.body) {
      console.error("❌ No response body for stream");
      process.exit(1);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() ?? "";
      for (const block of parts) {
        for (const line of block.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const ev = JSON.parse(raw) as {
              result?: unknown;
              error?: { message?: string };
            };
            if (ev.error) {
              console.error(`❌ ${ev.error.message}`);
              process.exit(1);
            }
            if (ev.result !== undefined) {
              process.stdout.write(JSON.stringify(ev.result) + "\n");
            }
          } catch {
            // ignore partial chunks
          }
        }
      }
    }
    console.log("\n✅ Stream complete.");
  }
  );
