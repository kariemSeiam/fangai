import type { AgentCard, AgentSkill } from "@a2a-js/sdk";
import type { FangConfig } from "./index.js";

/**
 * Build an A2A v1 Agent Card for @a2a-js/sdk / orchestrators.
 * `publicBase` should be reachable by clients (e.g. http://localhost:3001).
 */
export function buildSdkAgentCard(
  config: FangConfig,
  publicBase: string
): AgentCard {
  const base = publicBase.replace(/\/$/, "");
  const jsonRpcUrl = `${base}/a2a`;

  const skills: AgentSkill[] = config.specializations.map((id) => ({
    id,
    name: `${id} tasks`,
    description: `Coding and automation tasks related to ${id}.`,
    tags: [id, "cli", "fang"],
  }));

  return {
    name: config.name,
    description:
      `${config.name} — CLI coding agent wrapped by Fang. Backend: ${config.cli}`,
    version: "0.1.0",
    protocolVersion: "1.0",
    url: jsonRpcUrl,
    preferredTransport: "JSONRPC",
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    capabilities: {
      streaming: true,
      stateTransitionHistory: false,
      pushNotifications: false,
    },
    skills,
    additionalInterfaces: [
      { url: base, transport: "HTTP+JSON" },
      { url: jsonRpcUrl, transport: "JSONRPC" },
    ],
  };
}
