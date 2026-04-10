#!/usr/bin/env node

/**
 * Fang — wrap any CLI coding agent as an A2A-compliant server.
 * Binary: `fang` (alias: `a2a-cli`).
 */

import { Command } from "commander";
import { wrapCommand } from "./commands/wrap.js";
import { startCommand } from "./commands/start.js";
import { discoverCommand } from "./commands/discover.js";
import { detectCommand } from "./commands/detect.js";
import { sendCommand } from "./commands/send.js";
import { stopCommand } from "./commands/stop.js";

const program = new Command();

program
  .name("fang")
  .description("Fang — CLI agent → A2A bridge (wrap, detect, discover, send)")
  .version("0.1.0");

program.addCommand(wrapCommand);
program.addCommand(startCommand);
program.addCommand(detectCommand);
program.addCommand(discoverCommand);
program.addCommand(sendCommand);
program.addCommand(stopCommand);

program.parse();
