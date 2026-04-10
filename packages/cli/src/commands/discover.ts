import { Command } from "commander";

export const discoverCommand = new Command("discover")
  .description("Show running Fang-wrapped agents")
  .option("--json", "Output as JSON", false)
  .option("--network", "Scan local network (future)", false)
  .action(async (options: any) => {
    // Common ports to scan
    const ports = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008];
    const found: Array<{
      port: number;
      name: string;
      url: string;
      protocolVersion: string;
      skills: number;
      jsonRpc: string;
      healthAuth?: string;
    }> = [];

    for (const port of ports) {
      try {
        const base = `http://localhost:${port}`;
        const cardUrl = `${base}/.well-known/agent-card.json`;
        let res = await fetch(cardUrl, { signal: AbortSignal.timeout(1000) });
        if (!res.ok) {
          res = await fetch(`${base}/.well-known/agent.json`, {
            signal: AbortSignal.timeout(1000),
          });
        }
        if (res.ok) {
          const card = (await res.json()) as Record<string, unknown>;
          const skills = Array.isArray(card.skills) ? card.skills.length : 0;

          let healthAuth: string | undefined;
          try {
            const healthRes = await fetch(`${base}/health`, {
              signal: AbortSignal.timeout(800),
            });
            if (healthRes.ok) {
              const h = (await healthRes.json()) as { auth?: string };
              if (h.auth === "api-key" || h.auth === "none") {
                healthAuth = h.auth;
              }
            }
          } catch {
            /* optional */
          }

          found.push({
            port,
            name: (card.name as string) ?? "unknown",
            url: (card.url as string) ?? base,
            protocolVersion: (card.protocolVersion as string) ?? "—",
            skills,
            jsonRpc: `${base}/a2a`,
            ...(healthAuth ? { healthAuth } : {}),
          });
        }
      } catch {
        // Not running — skip
      }
    }

    if (found.length === 0) {
      console.log("No Fang agents found on common ports (3001–3008).");
      console.log("See installed CLIs: fang detect");
      console.log("Start one with: fang wrap \"pi --mode rpc\" --port 3001");
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(found, null, 2));
      return;
    }

    console.log(`\n🦷 Found ${found.length} running agent(s):\n`);
    for (const agent of found) {
      const authHint = agent.healthAuth ? `  auth:${agent.healthAuth}` : "";
      console.log(
        `  ${agent.name.padEnd(22)} :${agent.port}  A2A ${agent.protocolVersion}  skills:${agent.skills}${authHint}`
      );
      console.log(`    ${agent.jsonRpc}`);
    }
    console.log();
  });
