# Fang — Architecture (`@fangai/core`)

> *For contributors, integrators, and anyone who wants to understand how the bridge works — inside and out.*

---

## The Core Insight

Every CLI coding agent reads from stdin and writes to stdout. That's the universal interface. It's older than HTTP, older than JSON, older than every protocol we've invented since.

The A2A protocol speaks HTTP + SSE. CLI agents speak stdin/stdout.

**Fang** translates between them. That's it. That's the whole architecture.

```
Before:

  Orchestrator ──(A2A/HTTP)──► ??? ──(stdin/stdout)──► CLI Agent

After:

  Orchestrator ──(A2A/HTTP)──► Fang ──(stdin/stdout)──► CLI Agent
                                    │
                              FangServer (express)
                              Adapter (CLI-specific)
                              TaskManager (lifecycle)
                              SSEEmitter (streaming)
```

---

## Core Components

### 1. FangServer

Express app wired to **`@a2a-js/sdk`**: `DefaultRequestHandler`, `InMemoryTaskStore`, `FangAgentExecutor`, plus Express middleware from `@a2a-js/sdk/server/express` (`agentCardHandler`, `jsonRpcHandler`, `restHandler`). One instance per wrapped CLI agent.

```
FangServer (Express)
├── GET  /.well-known/agent-card.json   ← SDK agentCardHandler (alias: agent.json)
├── POST /a2a                           ← JSON-RPC 2.0 (message/send, message/stream, tasks/*, …)
├── *    /v1/…                          ← HTTP+JSON REST (spec-compliant snake_case boundary)
├── GET  /health                        ← Fang liveness (not part of A2A spec)
```

Legacy routes **`/tasks/send`**, **`/tasks/:id`**, **`/tasks/:id/stream`** were removed in favor of the SDK surface above. Use **`fang send`** (JSON-RPC) or any A2A client against **`/a2a`** or **`/v1/…`**.

Optional **`FangConfig.apiKey`** (or **`FANG_API_KEY`**) gates **`/a2a`** and REST; **`/.well-known`** and **`/health`** stay public — see **`../spec/14-SECURITY-AND-TRUST-BOUNDARIES.md`**. **`FangServer.listeningPort()`** returns the bound port when **`port: 0`**.

**Responsibilities:**
- Receive A2A protocol requests via the SDK
- Delegate to the Adapter for CLI-specific I/O
- Manage task lifecycle (create → running → completed/failed)
- Stream updates to SSE subscribers
- Clean up completed tasks after TTL

### 2. Adapter

The CLI-specific translator. Each supported agent has one.

```
A2A Task (standard)  ──Adapter──►  CLI stdin (agent-specific)
CLI stdout (varied)  ──Adapter──►  A2A TaskUpdate (standard)
```

**The adapter contract is three methods:**

| Method | Input | Output | Purpose |
|--------|-------|--------|---------|
| `formatInput(task)` | A2A Task | string | Format task as CLI input |
| `parseOutput(line)` | stdout line | TaskUpdate or null | Parse CLI output into A2A updates |
| `canHandle(cli)` | CLI command string | boolean | Auto-detection |

**Why adapters are small:** The complexity of each CLI agent is bounded. `pi --mode rpc` emits JSON events. `aider --json` has its own schema. `claude --print` streams text. The adapter just translates one format into another.

### 3. TaskManager

In-memory task lifecycle manager.

```
Task states:
  submitted ──► running ──► completed
                         ╰─► failed

Transitions:
  create(id, message)          → submitted
  update(id, TaskUpdate)       → running (first update)
  complete(id)                 → completed
  fail(id, error)              → failed
```

**Each task tracks:**
- Status (submitted/running/completed/failed)
- All updates (progress text, logs)
- Final result (aggregated from updates)
- Timestamps (created, completed)
- SSE subscribers (for streaming)

### 4. FangAgentExecutor

Implements the SDK’s **`AgentExecutor`**: bridges A2A tasks to the wrapped CLI. **Oneshot** adapters spawn a process per task; **persistent** adapters (e.g. Pi `--mode rpc`) keep one shell; **OpenCode** can use **`opencode serve`** via HTTP instead of spawning.

```
execute (per task):
  1. splitCli(config.cli) → cmd + argv; optional config.args
  2. spawn + stdin ← adapter.formatInput(task); stdout readline → adapter.parseOutput(line) → SDK event bus
  3. stderr → artifact/log events; exit / timeout → status updates; eventBus.finished()
```

### 5. SSEEmitter

Wraps an HTTP response into an SSE stream.

```
SSEEmitter(res):
  send(update):
    res.write(`data: ${JSON.stringify(update)}\n\n`)

  close():
    res.write('data: [DONE]\n\n')
    res.end()
```

---

## Data Flow (Complete)

```
                          ORCHESTRATOR
                               │
                   POST /a2a  (JSON-RPC message/send, …)
                   { message: "fix auth bug" }
                               │
                               ▼
                    ┌──── FangServer ────┐
                    │  @a2a-js/sdk       │
                    │  DefaultRequestHandler
                    │  + InMemoryTaskStore
                    │                    │
                    │  FangAgentExecutor │
                    │  (spawn / persist / OpenCode HTTP)
                    │                    │
                    └────────┬───────────┘
                             │
                    Task accepted / streaming
                             │
                             ▼
                    ┌──── Process ────┐
                    │                 │
                    │  spawn("pi",    │
                    │    ["--mode",   │
                    │     "rpc"])     │
                    │                 │
                    │  stdin ← ────── adapter.formatInput(task)
                    │  stdout ──────► line buffer
                    │  stderr ──────► error log
                    │                 │
                    └────┬──────┬─────┘
                         │      │
            stdout line  │      │  process exit
                         ▼      ▼
              adapter.parseOutput   code === 0?
              → TaskUpdate          ├─ yes → complete
              → SDK event bus        └─ no  → fail
                         │
                         ▼
              SSE / JSON-RPC result
              → orchestrator receives stream or final task
```

---

## Adapter Reference

### Pi Adapter

**CLI:** `pi --mode rpc`

**Protocol:** LF-delimited JSON events over stdin/stdout.

```typescript
// Input (to pi stdin)
{ "type": "message", "role": "user", "content": "fix the bug" }

// Output (from pi stdout) — one JSON per line
{ "type": "text", "content": "I'll analyze the bug..." }
{ "type": "tool_call", "name": "read", "input": { "path": "src/auth.ts" } }
{ "type": "tool_result", "name": "read", "output": "file contents..." }
{ "type": "text", "content": "Found the issue. The problem is..." }
{ "type": "tool_call", "name": "edit", "input": { ... } }
{ "type": "tool_result", "name": "edit", "output": "edited successfully" }
{ "type": "done", "total_tokens": 4231 }
```

**Adapter mapping:**

| pi Event | A2A TaskUpdate |
|----------|---------------|
| `text` | `{ type: "progress", text: content }` |
| `tool_call` | `{ type: "log", level: "info", text: "🔧 name" }` |
| `tool_result` | `{ type: "log", level: "info", text: "✅ name" }` |
| `done` | `{ type: "complete" }` |
| `error` | `{ type: "failed", text: message }` |

### Aider Adapter

**CLI:** `aider --no-auto-commits --json`

**Protocol:** JSON mode outputs structured events.

```typescript
// Input: plain text to stdin, terminated by /exit
"fix the auth bug\n/exit\n"

// Output: JSON lines
{ "type": "assistant", "content": "Analyzing..." }
{ "type": "commit", "commit_hash": "abc123" }
{ "type": "diff", "files": ["src/auth.ts"] }
```

### Claude Code Adapter

**CLI:** `claude --print`

**Protocol:** Streams text to stdout. Simple.

```typescript
// Input: task message + newline
"fix the auth bug\n"

// Output: plain text stream
"I'll analyze the auth module...\n"
"Found the issue in line 42...\n"
```

### OpenCode Adapter

**CLI:** `opencode --json-output`

**Protocol:** JSON events, similar to pi.

### Generic Adapter

**CLI:** Any stdin/stdout process.

**Protocol:** Text in, text out. No structure assumed.

```typescript
// Input: task message + newline
"fix the auth bug\n"

// Output: whatever the CLI prints
// Each non-empty line becomes a progress update
// Process exit code 0 = complete, non-zero = failed
```

---

## Auto-Detection

When you run `fang wrap "pi --mode rpc"`, the system auto-detects the adapter:

```typescript
const ADAPTERS = [
  PiAdapter,       // "pi" + "--mode rpc"  → native RPC
  AiderAdapter,    // "aider"              → JSON mode
  ClaudeAdapter,   // "claude" + "--print" → text stream
  OpenCodeAdapter, // "opencode"           → JSON output
  GenericAdapter,  // *                    → plain text fallback
];

function detectAdapter(cli: string): BaseAdapter {
  for (const Adapter of ADAPTERS) {
    if (Adapter.canHandle(cli)) return new Adapter();
  }
  return new GenericAdapter();
}
```

Priority order matters. `GenericAdapter.canHandle()` always returns `true`, so it must be last.

---

## Agent Card Schema

Every wrapped agent exposes a standard A2A Agent Card with **Fang** metadata extensions:

```typescript
interface AgentCard {
  // Standard A2A fields
  name: string;
  version: string;
  url: string;
  description?: string;
  capabilities: {
    streaming: boolean;
    async: boolean;
    parallel_tasks: number;
  };
  skills: Array<{
    id: string;
    name: string;
    tags: string[];
  }>;

  // Fang extensions (in metadata)
  metadata: {
    backend: string;          // the CLI command being wrapped
    model?: string;           // model hint
    cost_tier: string;        // free | cheap | paid | best
    strengths: string[];      // what this agent is best at
    bridge: string;           // "fang"
    framework?: string;       // pi | aider | claude | opencode | generic
    observability?: string;   // full (pi RPC) | partial (text) | minimal
    fang_version: string;     // bridge semver
  };
}
```

---

## Task Lifecycle

```
    ┌─────────────────────────────────────────────────────────┐
    │                                                         │
    │  JSON-RPC message/send (POST /a2a)                      │
    │       │                                                 │
    │       ▼                                                 │
    │  ┌──────────┐                                           │
    │  │ submitted│  ← task created, executor runs CLI        │
    │  └─────┬────┘                                           │
    │        │ spawn CLI process                              │
    │        ▼                                                │
    │  ┌──────────┐                                           │
    │  │ running  │  ← CLI is executing, updates flowing     │
    │  └─────┬────┘                                           │
    │        │                                                │
    │   ┌────┴─────┐                                          │
    │   │          │                                          │
    │   ▼          ▼                                          │
    │ ┌──────────┐ ┌──────────┐                               │
    │ │completed │ │  failed  │                               │
    │ └──────────┘ └──────────┘                               │
    │       │          │                                      │
    │       ▼          ▼                                      │
    │   SSE: complete   SSE: failed                           │
    │   TTL: 60s        TTL: 60s                              │
    │       │          │                                      │
    │       ▼          ▼                                      │
    │     cleanup     cleanup                                 │
    │                                                         │
    └─────────────────────────────────────────────────────────┘
```

**TTL:** Completed/failed tasks are kept in memory for 60 seconds for late-joining SSE subscribers, then garbage collected.

---

## Security Model

### Process Isolation

Each task spawns a **separate** child process. Tasks never share processes.

```
Task 1 → spawn("pi", ...) → Process A
Task 2 → spawn("pi", ...) → Process B  (separate process)
Task 3 → spawn("aider", ...) → Process C
```

### Threat Model

| Threat | Mitigation |
|--------|-----------|
| CLI agent writes to sensitive files | Run as dedicated user with restricted permissions |
| Orchestrator sends malicious tasks | `a2a.yaml` `allowed_origins` whitelist (v0.2) |
| CLI agent runs indefinitely | `--timeout` flag kills process after N seconds |
| Public internet exposure | Document: never expose without auth. Use nginx/caddy reverse proxy. |
| Task data leaks between tasks | Separate processes, separate stdio pipes |

### Production Checklist

- [ ] Run `fang` as a dedicated user (not root)
- [ ] Set `--timeout` for tasks (default: 300 seconds)
- [ ] Use reverse proxy with authentication
- [ ] Restrict file system access with OS permissions
- [ ] Keep CLI agents updated for security patches
- [ ] Monitor with `/health` endpoint
- [ ] Set `--max-parallel` to prevent resource exhaustion

---

## Performance Characteristics

### Per-Agent Overhead

```
FangServer (idle):       ~20MB RAM, 0% CPU
Per active task:         ~30-50MB (the CLI process itself)
SSE connections:         ~1KB per subscriber
Task metadata:           ~1KB per task
```

### Latency

```
Task submission → CLI spawn:  ~50-200ms (depends on CLI startup)
CLI output → SSE delivery:    <5ms (in-process, no network hop)
Health check response:        <1ms
Agent Card response:          <1ms
```

### Concurrency

- Each task is an isolated process — no shared state between tasks
- `--max-parallel` limits concurrent tasks (default: 4)
- Excess tasks are queued and processed FIFO
- No hard limit on queued tasks (bounded by memory)

---

## Error Handling

```
CLI won't start         → task status: failed, error: spawn error
CLI crashes mid-task    → task status: failed, error: exit code + stderr
CLI produces no output  → task stays "running" until timeout
Adapter can't parse     → line ignored, processing continues
SSE client disconnects  → subscriber removed, task continues
Health check fails      → FangServer logs error, attempts recovery
```

---

## Implementation reference (v3)

Older blueprints used custom **`/tasks/send`** routes; **current Fang** delegates HTTP to **`@a2a-js/sdk`** (`DefaultRequestHandler`, `InMemoryTaskStore`, `jsonRpcHandler`, `restHandler`, `agentCardHandler`). **`FangAgentExecutor`** is the **`AgentExecutor`** implementation.

| Module | Path | Role |
|--------|------|------|
| **FangServer** | `packages/core/src/FangServer.ts` | Express, SDK routes, `/health`, optional `apiKeyGate`, `listeningPort()` |
| **FangAgentExecutor** | `packages/core/src/FangAgentExecutor.ts` | Subprocess / persistent / OpenCode HTTP bridge |
| **TaskManager** | `packages/core/src/TaskManager.ts` | In-repo task helper (SDK owns primary task state via handler + store) |
| **BaseAdapter** | `packages/core/src/index.ts` | `formatInput`, `parseOutput`, `canHandle`, `executionMode` |
| **Adapter registry** | `packages/core/src/AdapterRegistry.ts` | `detectAdapter()` |

### BaseAdapter (sketch)

Types and abstract methods match **`packages/core/src/index.ts`** — see that file for the full contract.

---

## A2A surfaces (v1 via `@a2a-js/sdk`)

| Surface | Path | Notes |
|---------|------|--------|
| Agent Card | `GET /.well-known/agent-card.json` | Alias `/.well-known/agent.json` |
| JSON-RPC | `POST /a2a` | `message/send`, `message/stream`, `tasks/*`, … |
| REST | `/v1/…` | SDK HTTP+JSON |
| Health | `GET /health` | Fang-specific (`bridge`, `auth`, …) |

**Transport:** HTTP + SSE for streaming RPCs (no WebSocket in Fang).

**Authentication:** Optional API key on **`/a2a`** and REST; Agent Card and **`/health`** stay public by default — **`../spec/14-SECURITY-AND-TRUST-BOUNDARIES.md`**. Use **`fang wrap --host`** / **`FANG_HOST`** or a reverse proxy for deployment hardening.

---

## Writing a New Adapter (Full Guide)

### Step 1: Create the package

```bash
mkdir -p packages/adapters/my-agent/src
cd packages/adapters/my-agent
npm init -y
# Set name to @fangai/adapter-my-agent
```

### Step 2: Implement BaseAdapter

```typescript
// src/MyAgentAdapter.ts
import { BaseAdapter, Task, TaskUpdate } from "@fangai/core";

export class MyAgentAdapter extends BaseAdapter {
  formatInput(task: Task): string {
    // How does your CLI receive input via stdin?
    return JSON.stringify({ prompt: task.message }) + "\n";
  }

  parseOutput(line: string): TaskUpdate | null {
    if (!line.trim()) return null;
    try {
      const event = JSON.parse(line);
      if (event.type === "response") {
        return { type: "progress", text: event.content };
      }
      if (event.type === "done") {
        return { type: "complete", result: event.result };
      }
      if (event.type === "error") {
        return { type: "failed", text: event.message };
      }
    } catch {
      // Not JSON — treat as plain text progress
      return { type: "progress", text: line };
    }
    return null;
  }

  static canHandle(cli: string): boolean {
    return cli.includes("my-agent");
  }
}
```

### Step 3: Register

1. Add workspace package **`packages/adapters/my-agent/`** (see existing adapters).
2. In **`packages/core/src/AdapterRegistry.ts`**, append to **`knownAdapters`** (before **`@fangai/adapter-generic`**):

```typescript
{ module: "@fangai/adapter-my-agent", exportName: "MyAgentAdapter" },
```

### Step 4: Test

```bash
fang wrap "my-agent --my-flag" --port 3005
fang send --port 3005 "hello world"
```

### Step 5: PR

Open a pull request with:
- Adapter implementation
- `canHandle` tests
- A sample `parseOutput` test with real CLI output
- Update to supported agents table in README

---

## Development Setup

Canonical tree: **`fang/`** in [`kariemSeiam/fangai`](https://github.com/kariemSeiam/fangai). Specs and roadmap: **`../spec/README.md`**.

```bash
pnpm install

# Build all packages
pnpm -r build

# Tests + @fangai/core ESLint (same as CI)
pnpm run release:verify

# Or: tests only (root `pnpm test` runs build first)
pnpm test

# Manual smoke (after build)
pnpm exec fang -- wrap "echo hello" --port 3001

# In another terminal
curl http://localhost:3001/.well-known/agent-card.json
pnpm exec fang -- send --port 3001 "test task"
```

**Testing details:** HTTP contract tests (**`packages/core/src/__tests__/fangHttp.contract.test.ts`**), CLI smoke (**`packages/cli/…`**), matrices — **`../spec/12-TESTING-AND-CONTRACTS.md`**. Changelog: **`CHANGELOG.md`**.

---

## Deployment

### systemd

```ini
[Unit]
Description=fang %i agent
After=network.target

[Service]
Type=simple
User=a2a
WorkingDirectory=/home/a2a/project
ExecStart=/usr/local/bin/fang wrap "%i" --port %i
Restart=on-failure
RestartSec=5
EnvironmentFile=/home/a2a/.env

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim

# Install CLI agent + Fang
RUN npm install -g @mariozechner/pi-coding-agent @fangai/cli

# Your agent's API key
ENV ZAI_API_KEY=""

EXPOSE 3001
CMD ["fang", "wrap", "pi --mode rpc", "--port", "3001"]
```

### Docker Compose (full fleet)

```yaml
version: "3.9"

services:
  pi:
    build: { dockerfile: Dockerfile.pi }
    ports: ["3001:3001"]
    environment: [ZAI_API_KEY]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  claude:
    build: { dockerfile: Dockerfile.claude }
    ports: ["3002:3002"]
    environment: [ANTHROPIC_API_KEY]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3002/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  local:
    build: { dockerfile: Dockerfile.ollama }
    ports: ["3003:3003"]
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/health"]
      interval: 30s
      timeout: 5s
      retries: 3
```

---

## FAQ

**Q: Does this modify the CLI agent?**
No. The CLI runs exactly as it would from your terminal. Fang wraps it, not patches it.

**Q: What if my CLI doesn't have a JSON mode?**
The generic adapter treats every stdout line as a progress update. It works with anything.

**Q: Can multiple tasks run in parallel?**
Yes. Each task spawns a separate process. Configure `--max-parallel` to cap concurrency.

**Q: What about CLI agents that need interactive input?**
Fang writes to stdin once and closes it. Agents that need back-and-forth interaction need an adapter that handles their specific protocol (like pi's RPC mode).

**Q: Does it work with local models?**
Yes. If the CLI can run against Ollama, llama.cpp, or any local model, Fang wraps it the same way.

**Q: What happens when the CLI crashes?**
The task is marked `failed` with the exit code and stderr. The FangServer stays running and accepts new tasks.

**Q: Can I use this in production?**
Yes, with caveats: run behind a reverse proxy with authentication, use a dedicated OS user, and monitor with the `/health` endpoint. See the Security Model section.

**Q: Why not just use MCP?**
MCP connects agents to tools. A2A connects agents to agents. They solve different problems. Fang makes CLI agents speak A2A so orchestrators can coordinate them. You can absolutely use MCP alongside Fang — they're complementary.

**Q: Why "FangServer"?**
Because every octopus needs its fangs.

---

## See also

| Doc | Purpose |
| --- | --- |
| **[`README.md`](./README.md)** | Product overview, install, CLI reference |
| **[`docs/FANG-SPEC.md`](./docs/FANG-SPEC.md)** | Implementation draft (routes, executor, known gaps) |
| **[`docs/A2A-COMPLIANCE.md`](./docs/A2A-COMPLIANCE.md)** | A2A v1 mapping and examples |
| **[`docs/ADAPTERS.md`](./docs/ADAPTERS.md)** | Adapter contract and `BaseAdapter` |
| **[`docs/PUBLISHING.md`](./docs/PUBLISHING.md)** | `@fangai/*` npm checklist |
| **[`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md)** | From laptop to production |

---

## License

MIT

---

*Built because CLI agents deserve to be citizens.*
