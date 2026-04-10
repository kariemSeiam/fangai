import { execFile } from "child_process";
import { promisify } from "util";
import which from "which";

const execFileAsync = promisify(execFile);

/** Installed CLI useful for Fang wraps — lower tier = preferred for automation. */
export type HostAgentInfo = {
  id: string;
  binary: string;
  path: string;
  version: string;
  tier: number;
  /** Example `fang wrap ...` for this agent */
  wrapExample: string;
};

type Probe = {
  id: string;
  binary: string;
  tier: number;
  wrapExample: string;
};

const PROBES: Probe[] = [
  {
    id: "pi",
    binary: "pi",
    tier: 1,
    wrapExample: 'fang wrap "pi --mode rpc" --port 3001',
  },
  {
    id: "claude",
    binary: "claude",
    tier: 1,
    wrapExample: 'fang wrap "claude --print" --port 3002',
  },
  {
    id: "codex",
    binary: "codex",
    tier: 1,
    wrapExample: 'fang wrap "codex --json" --port 3003',
  },
  {
    id: "gemini",
    binary: "gemini",
    tier: 2,
    wrapExample: "fang wrap \"gemini --acp\" --port 3004",
  },
  {
    id: "goose",
    binary: "goose",
    tier: 2,
    wrapExample: 'fang wrap "goose" --port 3005',
  },
  {
    id: "opencode",
    binary: "opencode",
    tier: 2,
    wrapExample:
      'fang wrap opencode --open-code-url http://127.0.0.1:4096 --port 3006',
  },
  {
    id: "aider",
    binary: "aider",
    tier: 3,
    wrapExample:
      'fang wrap "aider --no-auto-commits --json" --port 3007',
  },
];

async function readVersion(absolutePath: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(absolutePath, args, {
      timeout: 10_000,
      windowsHide: true,
    });
    const line = stdout.trim().split(/\r?\n/)[0] ?? "";
    return line.length > 160 ? `${line.slice(0, 157)}…` : line || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Probe PATH for known coding-agent CLIs. Safe to call on any machine — missing
 * binaries are skipped.
 */
export async function detectHostAgents(): Promise<HostAgentInfo[]> {
  const out: HostAgentInfo[] = [];

  for (const p of PROBES) {
    try {
      const resolved = await which(p.binary);
      let version = await readVersion(resolved, ["--version"]);
      if (version === "unknown" && p.binary === "opencode") {
        version = await readVersion(resolved, ["version"]);
      }
      out.push({
        id: p.id,
        binary: p.binary,
        path: resolved,
        version,
        tier: p.tier,
        wrapExample: p.wrapExample,
      });
    } catch {
      /* not on PATH */
    }
  }

  return out.sort(
    (a, b) => a.tier - b.tier || a.binary.localeCompare(b.binary)
  );
}
