import { Command } from "commander";
import killPort from "kill-port";

type FangHealth = {
  status?: string;
  agent?: string;
  bridge?: string;
};

const DEFAULT_PORTS = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008];

function isFangBridge(h: FangHealth): boolean {
  return h.bridge === "fang";
}

export const stopCommand = new Command("stop")
  .description(
    "Stop Fang agents on common ports (verifies /health, then frees the port)"
  )
  .option(
    "-p, --port <n>",
    "Only this port (still must respond with Fang /health)"
  )
  .action(async (options: { port?: string }) => {
    const ports = options.port
      ? [Number.parseInt(options.port, 10)]
      : DEFAULT_PORTS;

    if (options.port && Number.isNaN(ports[0]!)) {
      console.error("Invalid --port");
      process.exit(1);
    }

    let stopped = 0;

    for (const port of ports) {
      try {
        const healthRes = await fetch(`http://localhost:${port}/health`, {
          signal: AbortSignal.timeout(1500),
        });
        if (!healthRes.ok) continue;

        const health = (await healthRes.json()) as FangHealth;
        if (!isFangBridge(health)) {
          console.log(
            `  Skip :${port} — not a Fang server (expected bridge=fang on /health)`
          );
          continue;
        }

        await killPort(port);
        console.log(
          `  ✓ Stopped ${health.agent ?? "fang"} on :${port}`
        );
        stopped++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (options.port) {
          console.error(`  ✗ :${port} — ${msg}`);
        }
      }
    }

    if (stopped === 0) {
      console.log(
        "\nNo Fang agents stopped. None matched, or nothing listening on those ports."
      );
      console.log("Tip: fang discover — see what is running\n");
      return;
    }

    console.log(`\nStopped ${stopped} Fang process(es).\n`);
  });
