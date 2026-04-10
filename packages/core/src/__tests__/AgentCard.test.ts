import { describe, it, expect } from "vitest";
import { buildAgentCard } from "../AgentCard.js";
import type { FangConfig } from "../index.js";

describe("buildAgentCard", () => {
  const baseConfig: FangConfig = {
    cli: "pi --mode rpc",
    port: 3001,
    name: "pi-agent",
    costTier: "cheap",
    specializations: ["typescript", "react"],
    maxParallel: 4,
  };

  it("builds a valid agent card", () => {
    const card = buildAgentCard(baseConfig);
    expect(card.name).toBe("pi-agent");
    expect(card.version).toBe("1.0.0");
    expect(card.url).toBe("http://localhost:3001");
    expect(card.capabilities.streaming).toBe(true);
    expect(card.capabilities.async).toBe(true);
    expect(card.capabilities.parallel_tasks).toBe(4);
  });

  it("maps specializations to skills", () => {
    const card = buildAgentCard(baseConfig);
    expect(card.skills).toHaveLength(2);
    expect(card.skills[0].id).toBe("typescript");
    expect(card.skills[0].tags).toContain("ts");
    expect(card.skills[0].tags).toContain("node");
    expect(card.skills[1].id).toBe("react");
    expect(card.skills[1].tags).toContain("frontend");
  });

  it("includes metadata with cost tier and model", () => {
    const config = { ...baseConfig, model: "glm-5.1" };
    const card = buildAgentCard(config);
    expect(card.metadata.backend).toBe("pi --mode rpc");
    expect(card.metadata.model).toBe("glm-5.1");
    expect(card.metadata.cost_tier).toBe("cheap");
    expect(card.metadata.strengths).toEqual(["typescript", "react"]);
  });

  it("handles unknown specializations", () => {
    const config = { ...baseConfig, specializations: ["rust", "wasm"] };
    const card = buildAgentCard(config);
    expect(card.skills[0].tags).toEqual(["rust"]);
    expect(card.skills[1].tags).toEqual(["wasm"]);
  });

  it("uses default maxParallel if not specified", () => {
    const config = { ...baseConfig, maxParallel: undefined };
    const card = buildAgentCard(config);
    expect(card.capabilities.parallel_tasks).toBe(4);
  });
});
