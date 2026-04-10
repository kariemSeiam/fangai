import { Command } from "commander";
import { detectHostAgents } from "@fangai/core";

export const detectCommand = new Command("detect")
  .description(
    "List coding-agent CLIs on your PATH (tier / version / example wrap command)"
  )
  .option("--json", "Output as JSON", false)
  .action(async (options: { json?: boolean }) => {
    const rows = await detectHostAgents();

    if (rows.length === 0) {
      console.log(
        "\nNo known agent binaries on PATH (pi, claude, aider, …).\n" +
          "Install one, then re-run: fang detect\n"
      );
      return;
    }

    if (options.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }

    console.log("\n🦷 Host agents (PATH)\n");
    console.log(
      "  Tier  Name      Version".padEnd(60) + "Path"
    );
    console.log("  " + "─".repeat(76));

    for (const r of rows) {
      const tier = `T${r.tier}`;
      const ver =
        r.version.length > 36 ? r.version.slice(0, 33) + "…" : r.version;
      console.log(
        `  ${tier.padEnd(4)} ${r.binary.padEnd(9)} ${ver.padEnd(36)} ${r.path}`
      );
    }

    console.log("\nExample wraps:\n");
    for (const r of rows) {
      console.log(`  ${r.wrapExample}`);
    }
    console.log();
  });
