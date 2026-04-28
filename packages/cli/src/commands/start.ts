import { Command } from "commander";
import { FangServer, type FangConfig, detectAdapter } from "@fangai/core";
import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";

interface ConfigFile {
  agents: Record<
    string,
    {
      cli: string;
      port: number;
      name?: string;
      cost_tier?: string;
      model?: string;
      skills?: string[];
      max_parallel?: number;
      timeout?: number;
    }
  >;
}

interface StartCommandOptions {
  config: string;
  background: boolean;
}

export const startCommand = new Command("start")
  .description("Start all agents from a2a.yaml")
  .option("--config <path>", "Path to config file", "./a2a.yaml")
  .option("--background", "Run as daemon (future)", false)
  .action(async (options: StartCommandOptions) => {
    let configText: string;
    try {
      configText = readFileSync(options.config, "utf-8");
    } catch {
      console.error(`❌ Config file not found: ${options.config}`);
      console.error("   Create an a2a.yaml (see README) or run: fang wrap …");
      process.exit(1);
    }

    const config = parseYaml(configText) as ConfigFile;
    if (!config.agents || Object.keys(config.agents).length === 0) {
      console.error("❌ No agents defined in config file.");
      process.exit(1);
    }

    const servers: FangServer[] = [];

    for (const [key, agent] of Object.entries(config.agents)) {
      const fangConfig: FangConfig = {
        cli: agent.cli,
        port: agent.port,
        name: agent.name ?? `${key}-agent`,
        model: agent.model,
        costTier: (agent.cost_tier as FangConfig["costTier"]) ?? "cheap",
        specializations: agent.skills ?? ["code"],
        maxParallel: agent.max_parallel,
        timeout: agent.timeout,
      };

      try {
        const adapter = await detectAdapter(agent.cli);
        const server = new FangServer(fangConfig, adapter);
        await server.start();
        servers.push(server);
      } catch (err: any) {
        console.error(`❌ Failed to start ${key}: ${err.message}`);
      }
    }

    console.log(`\n🦷 ${servers.length} agent(s) running. Ctrl+C to stop.`);

    // Graceful shutdown
    const shutdown = async () => {
      console.log("\n🦷 Stopping all agents...");
      for (const server of servers) {
        await server.stop();
      }
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
