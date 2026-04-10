import { Command } from "commander";
import { FangServer, type FangConfig, detectAdapter } from "@fangai/core";

export const wrapCommand = new Command("wrap")
  .alias("serve")
  .description("Wrap a CLI agent as an A2A v1 server (@a2a-js/sdk) — alias: fang serve")
  .argument("<command>", "CLI command to wrap (e.g., 'pi --mode rpc')")
  .option("-p, --port <n>", "Port to listen on", "3001")
  .option(
    "--host <addr>",
    "Listen address (omit = OS default, often all interfaces). Use 127.0.0.1 for localhost only; or set FANG_HOST"
  )
  .option("-n, --name <name>", "Agent name (auto-detected if omitted)")
  .option("--model <model>", "Model hint for orchestrators")
  .option(
    "--cost-tier <tier>",
    "Cost tier: free | cheap | paid | best",
    "cheap"
  )
  .option("--skills <skills>", "Comma-separated skill tags", "code")
  .option("--max-parallel <n>", "Max concurrent tasks", "4")
  .option("--timeout <seconds>", "Task timeout in seconds", "300")
  .option(
    "--open-code-url <url>",
    "Use a running OpenCode HTTP server (opencode serve) instead of spawning the CLI; pairs with CLI `opencode`"
  )
  .option(
    "--open-code-password <secret>",
    "Basic-auth password for OpenCode (or set OPENCODE_SERVER_PASSWORD)"
  )
  .option(
    "--open-code-directory <path>",
    "Optional workspace directory header for OpenCode SDK"
  )
  .option(
    "--api-key <secret>",
    "Require this key for /a2a and REST (or set FANG_API_KEY); agent card + /health stay public"
  )
  .action(async (command: string, options: any) => {
    const apiKey =
      (options.apiKey as string | undefined)?.trim() ||
      process.env.FANG_API_KEY?.trim() ||
      undefined;
    const host =
      (options.host as string | undefined)?.trim() ||
      process.env.FANG_HOST?.trim() ||
      undefined;

    const config: FangConfig = {
      cli: command,
      port: parseInt(options.port, 10),
      ...(host ? { host } : {}),
      name: options.name ?? deriveName(command),
      model: options.model,
      costTier: options.costTier as FangConfig["costTier"],
      specializations: options.skills.split(",").map((s: string) => s.trim()),
      maxParallel: parseInt(options.maxParallel, 10),
      timeout: parseInt(options.timeout, 10),
      ...(apiKey ? { apiKey } : {}),
      ...(options.openCodeUrl
        ? {
            openCodeServeUrl: options.openCodeUrl as string,
            openCodeServePassword:
              (options.openCodePassword as string | undefined) ??
              process.env.OPENCODE_SERVER_PASSWORD,
            ...(options.openCodeDirectory
              ? { openCodeDirectory: options.openCodeDirectory as string }
              : {}),
          }
        : {}),
    };

    console.log(`🦷 Wrapping: ${command}`);
    console.log(`   Name: ${config.name}`);
    console.log(`   Port: ${config.port}`);
    if (config.host) {
      console.log(`   Host: ${config.host}`);
    }
    console.log(`   Tier: ${config.costTier}`);
    console.log(`   Skills: ${config.specializations.join(", ")}`);
    if (config.openCodeServeUrl) {
      console.log(`   OpenCode HTTP: ${config.openCodeServeUrl}`);
    }
    if (config.apiKey) {
      console.log(`   API key: enabled (FANG_API_KEY / --api-key)`);
    }

    const adapter = await detectAdapter(command);
    const server = new FangServer(config, adapter);

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n🦷 ${signal} received, shutting down...`);
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    await server.start();
  });

function deriveName(cli: string): string {
  const base = cli.split(" ")[0].split("/").pop() ?? "agent";
  return `${base}-agent`;
}
