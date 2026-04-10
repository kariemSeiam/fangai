import type { AgentCard, FangConfig } from "./index.js";

const SKILL_TAG_MAP: Record<string, string[]> = {
  typescript: ["ts", "javascript", "node", "web"],
  react: ["frontend", "ui", "jsx", "tsx"],
  python: ["py", "backend", "api"],
  flask: ["python", "backend", "api"],
  "git-native": ["git", "refactor", "diff"],
  offline: ["local", "no-api", "private"],
  refactor: ["clean-code", "patterns", "rewrite"],
  debug: ["troubleshoot", "fix", "diagnose"],
  security: ["audit", "vulnerability", "hardening"],
  architecture: ["design", "system", "scaling"],
};

function getTagsForSpec(spec: string): string[] {
  return SKILL_TAG_MAP[spec] ?? [spec];
}

export function buildAgentCard(config: FangConfig): AgentCard {
  return {
    name: config.name,
    version: "1.0.0",
    url: `http://localhost:${config.port}`,
    description: `${config.name} — wrapped by Fang (CLI→A2A bridge)`,
    capabilities: {
      streaming: true,
      async: true,
      parallel_tasks: config.maxParallel ?? 4,
    },
    skills: config.specializations.map((spec) => ({
      id: spec,
      name: `${spec} coding task`,
      tags: getTagsForSpec(spec),
    })),
    metadata: {
      backend: config.cli,
      model: config.model ?? "unknown",
      cost_tier: config.costTier,
      strengths: config.specializations,
      bridge: "fang",
      fang_version: "0.1.0",
    },
  };
}
