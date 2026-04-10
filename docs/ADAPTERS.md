# Writing Adapters for Fang

> *Every CLI agent speaks a slightly different language. Adapters are the translators.*

---

## What Is an Adapter?

An adapter is a small TypeScript class that sits between Fang's **FangServer** and your CLI agent. It has one job: **translate between A2A protocol messages and CLI-specific stdin/stdout.**

```
A2A Task (standard)  ──formatInput──►  CLI stdin (agent-specific)
CLI stdout (varied)  ──parseOutput──►  A2A TaskUpdate (standard)
```

The adapter doesn't manage processes, HTTP, or SSE. It only handles translation. Everything else is handled by the core `FangServer`.

---

## The Contract

Every adapter extends `BaseAdapter` and implements three things:

```typescript
import { BaseAdapter, Task, TaskUpdate } from "@fangai/core";

export class MyAdapter extends BaseAdapter {
  /**
   * Format an A2A task into a string that gets written to the CLI's stdin.
   * 
   * @param task - The incoming A2A task
   * @returns string to write to stdin (usually ends with \n)
   */
  formatInput(task: Task): string {
    // Your implementation
  }

  /**
   * Parse a single line of CLI stdout into an A2A TaskUpdate.
   * Return null if the line should be ignored (empty lines, debug output, etc.)
   * 
   * @param line - One line from the CLI's stdout
   * @returns TaskUpdate or null
   */
  parseOutput(line: string): TaskUpdate | null {
    // Your implementation
  }

  /**
   * Detect if this adapter should handle the given CLI command.
   * Called during auto-detection when user runs `fang wrap <command>`.
   * 
   * @param cli - The full CLI command string (e.g., "pi --mode rpc")
   * @returns true if this adapter handles this CLI
   */
  static canHandle(cli: string): boolean {
    // Your implementation
  }
}
```

---

## Types Reference

```typescript
// What comes in from the orchestrator
interface Task {
  id: string;        // unique task ID (UUID)
  message: string;   // the user's message/task description
}

// What goes out to the orchestrator
type TaskUpdate = {
  type: "progress";   // intermediate output (streamed to SSE)
  text: string;
} | {
  type: "complete";   // task finished successfully
  result?: string;    // final result (optional — aggregated from progress if omitted)
} | {
  type: "failed";     // task failed
  text: string;       // error message
} | {
  type: "log";        // informational log (not streamed to user, visible in debug)
  level: "info" | "error";
  text: string;
};
```

---

## Step-by-Step: Writing an Adapter

### Step 1: Create the Package

```bash
cd packages/adapters
mkdir my-agent && cd my-agent
cat > package.json << 'EOF'
{
  "name": "@fangai/adapter-my-agent",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "@fangai/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  }
}
EOF
```

### Step 2: Create the Adapter

```typescript
// src/index.ts
import { BaseAdapter, Task, TaskUpdate } from "@fangai/core";

export class MyAgentAdapter extends BaseAdapter {
  
  formatInput(task: Task): string {
    // How does your CLI expect to receive input?
    // Examples:
    //   - Plain text: return task.message + "\n"
    //   - JSON: return JSON.stringify({ prompt: task.message }) + "\n"
    //   - Custom protocol: return however your CLI expects it
    return task.message + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    // Skip empty lines
    if (!line.trim()) return null;

    // Try JSON parsing first (most structured CLIs output JSON)
    try {
      const event = JSON.parse(line);
      
      // Map your CLI's event types to A2A TaskUpdate types
      if (event.type === "response" || event.type === "text") {
        return { type: "progress", text: event.content || event.text };
      }
      if (event.type === "done" || event.type === "complete") {
        return { type: "complete", result: event.result || event.content };
      }
      if (event.type === "error") {
        return { type: "failed", text: event.message || event.error };
      }
      // Unknown JSON event — log it
      return { type: "log", level: "info", text: line };
    } catch {
      // Not JSON — treat as plain text progress
      return { type: "progress", text: line };
    }
  }

  static canHandle(cli: string): boolean {
    // Return true if this adapter should handle the given CLI command
    return cli.includes("my-agent");
  }
}
```

### Step 3: Write Tests

```typescript
// src/__tests__/MyAgentAdapter.test.ts
import { describe, it, expect } from "vitest";
import { MyAgentAdapter } from "../index";

describe("MyAgentAdapter", () => {
  const adapter = new MyAgentAdapter();

  describe("canHandle", () => {
    it("handles my-agent commands", () => {
      expect(MyAgentAdapter.canHandle("my-agent")).toBe(true);
      expect(MyAgentAdapter.canHandle("my-agent --json")).toBe(true);
    });

    it("rejects other commands", () => {
      expect(MyAgentAdapter.canHandle("pi --mode rpc")).toBe(false);
      expect(MyAgentAdapter.canHandle("aider")).toBe(false);
    });
  });

  describe("formatInput", () => {
    it("formats task as stdin input", () => {
      const result = adapter.formatInput({ id: "1", message: "fix the bug" });
      expect(result).toContain("fix the bug");
    });
  });

  describe("parseOutput", () => {
    it("parses response events", () => {
      const result = adapter.parseOutput(
        JSON.stringify({ type: "response", content: "analyzing..." })
      );
      expect(result).toEqual({ type: "progress", text: "analyzing..." });
    });

    it("parses done events", () => {
      const result = adapter.parseOutput(
        JSON.stringify({ type: "done", result: "fixed" })
      );
      expect(result).toEqual({ type: "complete", result: "fixed" });
    });

    it("parses error events", () => {
      const result = adapter.parseOutput(
        JSON.stringify({ type: "error", message: "something broke" })
      );
      expect(result).toEqual({ type: "failed", text: "something broke" });
    });

    it("ignores empty lines", () => {
      expect(adapter.parseOutput("")).toBeNull();
      expect(adapter.parseOutput("   ")).toBeNull();
    });

    it("handles plain text as progress", () => {
      const result = adapter.parseOutput("some plain text output");
      expect(result).toEqual({ type: "progress", text: "some plain text output" });
    });
  });
});
```

### Step 4: Register the Adapter

Add to `packages/core/src/AdapterRegistry.ts`:

```typescript
import { MyAgentAdapter } from "@fangai/adapter-my-agent";

const ADAPTERS = [
  PiAdapter,
  AiderAdapter,
  ClaudeAdapter,
  OpenCodeAdapter,
  MyAgentAdapter,     // ← add here, before GenericAdapter
  GenericAdapter,     // ← always last
];
```

### Step 5: Test End-to-End

```bash
pnpm -r build

# If my-agent is installed globally
fang wrap "my-agent --my-flag" --port 3005

# Test it
fang send --port 3005 "hello world"
curl http://localhost:3005/.well-known/agent.json | jq
```

### Step 6: Open a PR

Your PR should include:
- [ ] Adapter implementation (`src/index.ts`)
- [ ] Tests (`src/__tests__/`)
- [ ] Updated supported agents table in README
- [ ] Real CLI output samples in test fixtures (if possible)

---

## Adapter Patterns

### Pattern 1: JSON Lines (Most Common)

Most structured CLIs output one JSON object per line. This is the easiest to parse.

```typescript
parseOutput(line: string): TaskUpdate | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line);
    // map event.type → TaskUpdate.type
  } catch {
    return null; // skip non-JSON lines
  }
}
```

**Used by:** pi (`--mode rpc`), aider (`--json`), opencode (`--json-output`)

### Pattern 2: Plain Text Stream

Some CLIs just write text. Every non-empty line is progress.

```typescript
parseOutput(line: string): TaskUpdate | null {
  if (!line.trim()) return null;
  return { type: "progress", text: line };
}
```

**Used by:** claude (`--print`), generic fallback

### Pattern 3: ANSI-Colored Text

Some CLIs output colored text. Strip ANSI codes first.

```typescript
parseOutput(line: string): TaskUpdate | null {
  const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
  if (!clean) return null;
  return { type: "progress", text: clean };
}
```

### Pattern 4: Mixed JSON and Text

Some CLIs interleave JSON events with plain text output.

```typescript
parseOutput(line: string): TaskUpdate | null {
  if (!line.trim()) return null;
  try {
    const event = JSON.parse(line);
    // handle structured events
  } catch {
    // plain text — still valuable as progress
    return { type: "progress", text: line };
  }
}
```

### Pattern 5: Prompt-Based (Interactive CLIs)

Some CLIs have a REPL with prompts. These are harder to wrap.

```typescript
formatInput(task: Task): string {
  // Send the task, then exit the REPL
  return task.message + "\n/exit\n";
}
```

For CLIs that need back-and-forth interaction, you may need a more sophisticated adapter that tracks state and matches prompts. This is advanced — start with simpler CLIs first.

---

## Testing Your Adapter

### Unit Tests (Required)

Test `formatInput`, `parseOutput`, and `canHandle` in isolation. Use real CLI output samples when possible.

```typescript
// Capture real output from your CLI:
// $ my-agent --my-flag "hello" 2>&1 | tee output_samples.txt

// Then use those samples in tests:
const realOutput = fs.readFileSync("fixtures/output_sample.txt", "utf-8");
for (const line of realOutput.split("\n")) {
  const update = adapter.parseOutput(line);
  // assert expectations
}
```

### Integration Tests (Encouraged)

If the CLI agent is installed in CI:

```typescript
it("wraps and sends a task", async () => {
  const server = new FangServer(config, new MyAgentAdapter());
  await server.start();
  
  const response = await fetch("http://localhost:3005/a2a", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "1",
      method: "message/send",
      params: {
        message: {
          kind: "message",
          role: "user",
          messageId: crypto.randomUUID(),
          parts: [{ kind: "text", text: "echo hello" }],
        },
      },
    }),
  });

  expect(response.ok).toBe(true);
  const body = await response.json();
  expect(body.result).toBeDefined();
  
  server.stop();
});
```

---

## Common Pitfalls

| Pitfall | Solution |
|---------|----------|
| CLI buffers stdout | Many CLIs buffer when stdout is a pipe. Set `env.FORCE_COLOR=0` or `env.NODE_OPTIONS="--no-buffering"` |
| CLI needs a TTY | Some CLIs detect TTY. Set `stdio: ['pipe', 'pipe', 'pipe']` and hope for the best, or use `script`/`pty` as a wrapper |
| CLI outputs ANSI codes | Strip them: `line.replace(/\x1b\[[0-9;]*m/g, "")` |
| CLI outputs progress bars | Progress bars use `\r`. Filter lines containing `\r` or handle them in `parseOutput` |
| CLI never exits | Set `--timeout` (default 300s). The FangServer kills the process. |
| CLI writes to stderr only | The core bridges both stdout and stderr. Stderr becomes log updates. |
| Multi-line JSON | Rare, but handle with a buffer that accumulates until valid JSON |

---

## Adapter Quality Checklist

- [ ] `canHandle` is specific enough to not collide with other adapters
- [ ] `formatInput` produces valid input for the CLI
- [ ] `parseOutput` handles JSON, plain text, and empty lines
- [ ] `parseOutput` handles malformed input gracefully (never throws)
- [ ] Unit tests with real CLI output samples
- [ ] Works end-to-end with `fang wrap` + `fang send`
- [ ] README updated in supported agents table

---

## Questions?

Open an issue with the `adapter` label. We'll help you figure it out.

---

## See also

| Doc | Purpose |
| --- | --- |
| **[`FANG-SPEC.md`](./FANG-SPEC.md)** | Routes, executor, adapter gaps |
| **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** | Diagrams, FAQ, doc hub |
| **[`A2A-COMPLIANCE.md`](./A2A-COMPLIANCE.md)** | A2A mapping from HTTP |
| **[`PUBLISHING.md`](./PUBLISHING.md)** | Shipping `@fangai/adapter-*` |

---

*Every new adapter grows the bridge.*
