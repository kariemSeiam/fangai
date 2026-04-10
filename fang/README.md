<div align="center">

<br/>

```
 █████╗ ██████╗  █████╗      ██████╗██╗     ██╗
██╔══██╗╚════██╗██╔══██╗    ██╔════╝██║     ██║
███████║ █████╔╝███████║    ██║     ██║     ██║
██╔══██║██╔═══╝ ██╔══██║    ██║     ██║     ██║
██║  ██║███████╗██║  ██║    ╚██████╗███████╗██║
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝    ╚═════╝╚══════╝╚═╝
```

### **Fang — any CLI agent. A2A citizen. One command.**

*Universal CLI→A2A bridge: preserve subprocess efficiency, gain standards-based orchestration.*

**Implementation root:** this directory (`fang/` in [`kariemSeiam/fangai`](https://github.com/kariemSeiam/fangai)) is the **pnpm workspace** for `@fangai/*`. Product **spec, roadmap, and ADRs:** [`../spec/README.md`](../spec/README.md). **Technical docs:** [`ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/FANG-SPEC.md`](docs/FANG-SPEC.md).

<br/>

[![Status](https://img.shields.io/badge/status-pre--release-orange?style=for-the-badge)](docs/PUBLISHING.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![A2A Protocol](https://img.shields.io/badge/A2A-v1.0-blue?style=for-the-badge)](https://github.com/a2aproject/A2A)
[![MCP](https://img.shields.io/badge/MCP-tools%20plane-green?style=for-the-badge)](https://modelcontextprotocol.io)

<br/>

</div>

> **Pre-release.** Packages publish under the **`@fangai`** scope (`@fangai/core`, `@fangai/cli`, adapters, etc.); end users usually install **`@fangai/cli`** globally. Primary binary: **`fang`** (compat alias: **`a2a-cli`**). The **unscoped** package name `a2a-cli` on npm is a different project (A2A *client*)—see [docs/PUBLISHING.md](docs/PUBLISHING.md). Install [from source](#install-from-source) until publish.

---

## The Problem

You have `pi`, `aider`, `claude-code`, `opencode`, `goose`, `amp`, `plandex` — some of the most powerful coding agents ever built.

And every single one of them is **alone**.

```
pi          → does the job. disappears.
aider       → does the job. disappears.
claude-code → does the job. disappears.
```

No orchestrator can discover them. No multi-agent system can delegate to them. No workflow can compose them.

They are **processes** — not **citizens**.

Meanwhile, the A2A protocol exists. MCP exists. Google, Anthropic, and 146 enterprises agreed on how agents should talk to each other. The language exists. The agents exist.

**The bridge was missing.**

---

## Why Fang

**Fang** is the vendor-neutral **CLI → A2A** adapter: run any coding agent as a subprocess, speak **HTTP + SSE** upward (orchestrators, ADKs, gateways) and **stdin/stdout** downward. No tool today fills “arbitrary CLI coding agent as full A2A server” end-to-end; closest analogs are **Gemini-specific** wrappers or **proprietary** REST shims (e.g. unified REST around several CLIs)—Fang targets **open A2A** and **any** agent you can spawn.

### Three tiers of CLI programmability (wrapping cost)

| Tier | Interface | Examples | Fang strategy |
|------|-----------|----------|----------------|
| **1** | Line-delimited JSON / NDJSON RPC | Pi `--mode rpc`, Claude Code stream-json, Codex `--json` | Direct parse → `TaskUpdate` / SSE |
| **2** | ACP (JSON-RPC over stdio) or mixed | Gemini CLI, Goose, OpenCode | ACP↔A2A mapping (expand adapters) |
| **3** | Text / one-shot | Aider-style flows, minimal TUI | Line heuristics + stdin formatting |

*Products such as **agentapi** unify several agents behind a **custom** HTTP API; Fang’s bet is **A2A** so LangGraph / ADK / LiteLLM-style gateways can treat every CLI agent as a first-class peer.*

### Token economics (positioning)

Third-party studies and vendor write-ups often show **large** context cost gaps between **orchestrator-injected MCP tool schemas** and **delegating work to a subprocess** that keeps its own tools internal—sometimes cited in the **~4–32×** range for comparable prompts (methodology varies; use as directional, not a guarantee). **A2A** discovery uses a small **Agent Card**; it does not require pasting whole tool catalogs into the parent model. Fang is aligned with that separation: **light** control plane, **heavy** work stays inside the CLI process.

---

## The Solution

```bash
# When published: npx @fangai/cli wrap "pi --mode rpc" --port 3001 --name pi-agent
pnpm exec fang -- wrap "pi --mode rpc" --port 3001 --name pi-agent   # dev clone (from monorepo root)
```

That one command turns `pi` into:

- ✅ An **A2A-compliant agent** with a discoverable Agent Card
- ✅ **Callable** via standard HTTP/SSE by any orchestrator
- ✅ **Streamable** — responses flow in real-time to any client
- ✅ **Composable** — works with LangGraph, CrewAI, AutoGen, or raw HTTP
- ✅ **Zero-modification** — the CLI agent doesn't change at all

```bash
# Wrap everything you have
fang wrap "pi --mode rpc" --port 3001 --name pi-agent
fang wrap "aider --no-auto-commits --json" --port 3002 --name aider-agent
fang wrap "claude --print" --port 3003 --name claude-agent
fang wrap "ollama run qwen2.5-coder" --port 3004 --name local-agent

# See what's alive
fang discover

# Send a task to any of them
fang send --port 3001 "refactor src/auth.ts to use async/await throughout"
```

---

## How It Works

```
  Any A2A Orchestrator
  (LangGraph, CrewAI, VENOM, your code)
          │
          │  POST /a2a/ (JSON-RPC) or /v1/… (REST)
          │  GET  /.well-known/agent-card.json
          ▼
   ┌──────────────┐
   │    Fang      │  ← FangServer (Express + @a2a-js/sdk)
   │   (bridge)   │
   └──────┬───────┘
          │  stdin/stdout (JSON, text, whatever the CLI speaks)
          ▼
   ┌──────────────┐
   │  pi --rpc    │  ← your CLI agent, running unchanged
   │  aider       │
   │  any CLI     │
   └──────────────┘
```

**Fang** speaks two languages simultaneously:

- **Upward**: **A2A v1 via [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk)** — JSON-RPC at `POST /a2a`, HTTP+JSON REST under `/v1/…`, Agent Card at `/.well-known/agent-card.json` (alias `agent.json`). Streaming uses the SDK’s SSE framing for `message/stream`.
- **Downward**: stdin/stdout (whatever the CLI agent already speaks)

The CLI agent never changes. The protocol never changes. The bridge just connects them.

---

## Install from source

```bash
git clone https://github.com/kariemSeiam/fangai.git
cd fangai/fang
pnpm install
pnpm -r build
pnpm exec fang -- --help
# Optional: pnpm link --global --filter @fangai/cli   → `fang` / `a2a-cli` on PATH
```

## 30-Second Demo

```bash
# 1. Build (see above). After npm publish: npm install -g @fangai/cli

# 2. Wrap an agent
fang wrap "pi --mode rpc" --port 3001

# 3. Check its Agent Card (this is what orchestrators see)
curl http://localhost:3001/.well-known/agent-card.json | jq

# 4. Send a task (JSON-RPC message/send)
curl -s -X POST http://localhost:3001/a2a/ \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"demo","parts":[{"kind":"text","text":"list files in this project"}]}}}'

# Or use the CLI
fang send --no-stream --port 3001 "list files in this project"
```

---

## Supported Agents

| Agent | Command | Adapter Status | Notes |
|-------|---------|---------------|-------|
| **[pi](https://github.com/badlogic/pi-mono)** | `pi --mode rpc` | ✅ Native RPC | JSON events, full observability |
| **[aider](https://github.com/Aider-AI/aider)** | `aider --json` | ✅ Native | git-native, best for refactors |
| **[claude-code](https://docs.anthropic.com/en/docs/claude-code)** | `claude --print` | ✅ Native | Anthropic's official CLI |
| **[opencode](https://github.com/opencode-ai/opencode)** | `opencode` | ✅ Native | Multi-provider |
| **[goose](https://github.com/block/goose)** | `goose run` | 🔶 Beta | Block's open agent |
| **[amp](https://github.com/ampcode/amp)** | `amp --pipe` | 🔶 Beta | |
| **[plandex](https://github.com/plandex-ai/plandex)** | `plandex tell` | 🔶 Beta | |
| **Any CLI** | `--mode generic` | ✅ Fallback | If it reads stdin and writes stdout, it works |

### Writing a New Adapter

It's one file, three methods:

```typescript
import { BaseAdapter, Task, TaskUpdate } from "@fangai/core";

export class MyAdapter extends BaseAdapter {
  // What to write to stdin when a task arrives
  formatInput(task: Task): string {
    return task.message + "\n";
  }

  // How to parse each line of CLI output
  parseOutput(line: string): TaskUpdate | null {
    if (!line.trim()) return null;
    return { type: "progress", text: line };
  }

  // Which CLI commands this adapter handles
  static canHandle(cli: string): boolean {
    return cli.startsWith("my-agent");
  }
}
```

See [`docs/ADAPTERS.md`](docs/ADAPTERS.md) for the full guide.

---

## Configuration

### Quick Start (CLI flags)

```bash
fang wrap <command> [options]

Options:
  --port, -p        Port (default: 3001)
  --name, -n        Agent name (default: auto-detected)
  --model           Model hint for orchestrators
  --cost-tier       free | cheap | paid | best
  --skills          Comma-separated tags
  --max-parallel    Max concurrent tasks (default: 4)
  --mode            rpc | print | generic (default: auto-detect)
```

### Multi-Agent Config (`a2a.yaml`)

Create `a2a.yaml` in your project root:

```yaml
# a2a.yaml — define your agent fleet
agents:
  # Your daily driver — cheap, fast, observability
  pi:
    cli: "pi --mode rpc"
    port: 3001
    name: pi-agent
    cost_tier: cheap
    model: glm-5.1
    skills: [typescript, react, python, refactor, debug]
    max_parallel: 4

  # Your heavy thinker — expensive, deep reasoning
  claude:
    cli: "claude --print"
    port: 3002
    name: claude-agent
    cost_tier: paid
    model: claude-sonnet-4-20250514
    skills: [architecture, complex-reasoning, security]

  # Your local worker — free, private, offline
  local:
    cli: "ollama run qwen2.5-coder:32b"
    port: 3003
    name: local-agent
    cost_tier: free
    skills: [quick-edits, offline, sensitive-code]

  # Your git specialist
  aider:
    cli: "aider --no-auto-commits --json"
    port: 3004
    name: aider-agent
    cost_tier: paid
    skills: [git-native, large-refactor, multi-file]
```

Start the whole fleet:

```bash
fang start               # starts all agents from a2a.yaml
fang discover            # shows running agents + health
fang stop                # graceful shutdown
```

---

## Agent Card (Auto-Generated)

Every wrapped agent gets a standard A2A Agent Card at `/.well-known/agent.json`:

```json
{
  "name": "pi-agent",
  "version": "1.0.0",
  "url": "http://localhost:3001",
  "capabilities": {
    "streaming": true,
    "async": true,
    "parallel_tasks": 4
  },
  "skills": [
    { "id": "typescript", "name": "TypeScript coding", "tags": ["ts", "node", "web"] },
    { "id": "refactor", "name": "Code refactoring", "tags": ["clean-code", "patterns"] }
  ],
  "metadata": {
    "backend": "pi --mode rpc",
    "model": "glm-5.1",
    "cost_tier": "cheap",
    "framework": "pi",
    "observability": "full"
  }
}
```

This is what any A2A orchestrator reads to discover and route to your agents.

---

## Orchestration Examples

### With Any A2A Client

```typescript
import { A2AClient } from "@a2aproject/a2a-js";

const pi = new A2AClient({ baseUrl: "http://localhost:3001" });
const claude = new A2AClient({ baseUrl: "http://localhost:3002" });

// Delegate to the right brain for the right task
const analysis = await pi.sendTask("analyze src/auth/ for security issues");
const fix = await claude.sendTask(`fix these security issues:\n${analysis.result}`);
```

### With LangGraph

```python
from langgraph.a2a import A2ATool

# pi-agent is now a LangGraph tool
pi_tool = A2ATool(url="http://localhost:3001", name="pi_coder")

graph = StateGraph(AgentState)
graph.add_node("coder", pi_tool.invoke)
graph.add_edge(START, "coder")
```

### With Raw HTTP

Prefer **`fang send`** or **`@fangai/client`**. JSON-RPC is **`POST /a2a`** (not legacy **`/tasks/send`**):

```bash
curl -s -X POST http://localhost:3001/a2a \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"demo-1","parts":[{"kind":"text","text":"add unit tests for auth.ts"}]}}}'
```

Streaming uses **`message/stream`** on the same endpoint (SSE) — see **`FangClient.streamMessage`** or **`fang send`**.

### With CrewAI / AutoGen

Any framework that speaks A2A can use **Fang-wrapped** agents as team members. No custom integrations needed.

---

## Architecture

```
fang/                   # pnpm workspace in github.com/kariemSeiam/fangai (npm: @fangai/*)
├── packages/
│   ├── core/               ← @fangai/core
│   ├── client/             ← @fangai/client
│   ├── pi/                 ← @fangai/pi
│   ├── adapters/
│   │   ├── aider/ | claude/ | codex/ | opencode/ | generic/
│   └── cli/                ← @fangai/cli (bin: fang, a2a-cli); commands: wrap, send, discover, detect, stop, start
│
├── docs/
│   ├── FANG-SPEC.md        ← implementation draft (keep in sync with code)
│   ├── ADAPTERS.md
│   ├── A2A-COMPLIANCE.md
│   ├── DEPLOYMENT.md
│   └── PUBLISHING.md
│
├── ARCHITECTURE.md         ← architecture guide (repo root)
├── CHANGELOG.md
├── a2a.yaml                ← example multi-agent config
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

---

## CLI Reference

```
fang <command> [options]

Commands:
  wrap <command>     Wrap a CLI agent as an A2A server (alias: serve)
  start              Start all agents from a2a.yaml
  detect             Detect installed CLIs and suggest wrap commands
  discover           Show running agents + health status
  send <task>        Send a task to a running agent
  stop               Gracefully stop all running agents

Options:
  -h, --help         Show help
  -V, --version      Show version
  --verbose          Debug output
```

---

## Deployment

### systemd (VPS / bare metal)

```ini
# /etc/systemd/system/pi-agent.service
[Unit]
Description=fang pi-agent
After=network.target

[Service]
Type=simple
User=a2a
WorkingDirectory=/home/a2a/project
ExecStart=/usr/bin/fang wrap "pi --mode rpc" --port 3001 --name pi-agent
Restart=on-failure
RestartSec=5
Environment=ZAI_API_KEY=your-key-here

[Install]
WantedBy=multi-user.target
```

### Docker

```dockerfile
FROM node:20-slim

RUN npm install -g @mariozechner/pi-coding-agent @fangai/cli

ENV ZAI_API_KEY=""
EXPOSE 3001

CMD ["fang", "wrap", "pi --mode rpc", "--port", "3001", "--name", "pi-agent"]
```

### Docker Compose (full fleet)

```yaml
services:
  pi-agent:
    build: { context: ., dockerfile: Dockerfile.pi }
    ports: ["3001:3001"]
    environment: [ZAI_API_KEY]
    restart: unless-stopped

  claude-agent:
    build: { context: ., dockerfile: Dockerfile.claude }
    ports: ["3002:3002"]
    environment: [ANTHROPIC_API_KEY]
    restart: unless-stopped

  local-agent:
    build: { context: ., dockerfile: Dockerfile.ollama }
    ports: ["3003:3003"]
    restart: unless-stopped

  # Optional: add an orchestrator that uses all three
  # orchestrator:
  #   build: { context: ., dockerfile: Dockerfile.orchestrator }
  #   depends_on: [pi-agent, claude-agent, local-agent]
```

---

## The Bigger Picture

### Why This Matters Now

The AI agent ecosystem in 2026:

- **MCP** — 97M monthly downloads. Every AI company builds on it. How agents talk to tools.
- **A2A** — v1.0 released. 146 enterprise members. How agents talk to each other.
- **CLI agents** — pi, aider, claude-code, opencode — brilliant, powerful, isolated.

The protocols exist. The agents exist. The bridge didn't.

**Fang** is that bridge.

### The Economics

| Setup | Monthly Cost |
|-------|-------------|
| Claude Max | $200 |
| OpenAI Pro | $200 |
| Cursor Pro | $40 |
| **Fang + GLM Pro + free tiers + local GPU** | **$30** |

If you're a developer in Cairo, Lagos, Karachi, or Jakarta — $200/month isn't realistic. But $30/month with intelligent routing? That's infrastructure equality.

Fang doesn't solve routing — it makes routing *possible*. Once your agents are A2A citizens, any orchestrator can route to them based on cost, capability, or availability.

### The Octopus Principle

An octopus has 2/3 of its neurons in its arms, not its brain. Each arm can taste, touch, and decide independently — while the brain coordinates.

CLI agents are arms. Fang gives them citizenship. The orchestrator is the brain.

Not a monolith. A distributed organism.

---

## Roadmap

Release history: [CHANGELOG.md](CHANGELOG.md). Phased spec: [`../spec/05-ROADMAP-PHASES.md`](../spec/05-ROADMAP-PHASES.md).

### v0.1 — The Bridge *(current)*
- [x] `fang wrap` — wrap any CLI as A2A server
- [x] Auto-detected adapters (pi, aider, claude, opencode, generic)
- [x] Auto-generated Agent Cards
- [x] SSE streaming
- [x] `a2a.yaml` multi-agent config
- [x] `fang send`, `fang detect`, `fang start` / `discover` / `stop`

### v0.2 — Discovery
- [ ] mDNS/DNS-SD local network discovery
- [ ] Health checks + auto-restart
- [ ] Agent Card extensions (cost, latency history, quality scores)
- [ ] `fang route "<task>"` — semantic routing across agents

### v0.3 — Compose
- [ ] Built-in lightweight orchestrator (task decomposition + routing)
- [ ] LiteLLM provider integration
- [ ] Kubernetes manifests
- [ ] Prometheus metrics endpoint

### v1.0 — Ecosystem
- [ ] Public agent registry at `a2acli.dev`
- [ ] `fang publish` — share agent configs
- [ ] One-click deploy (Fly.io / Railway / Hetzner)
- [ ] Web dashboard for fleet monitoring

---

## Contributing

We welcome contributions — especially:

1. **New adapters** — wrap a CLI we don't support yet
2. **Bug reports** — tell us what breaks
3. **Orchestration examples** — show your multi-agent setup
4. **Documentation** — improve guides, add translations

See [`CONTRIBUTING.md`](CONTRIBUTING.md) to get started.

### Good First Issues

- [ ] Add adapter for `goose` (Block's open agent)
- [ ] Add adapter for `plandex`
- [ ] Add Windows service deployment guide
- [ ] Add ARM64 Docker images
- [ ] Translate README to Chinese, Japanese, Korean, Arabic

---

## Community

Issues and PRs welcome via the repository that hosts this package (see [`CONTRIBUTING.md`](CONTRIBUTING.md)). Discord / Discussions links will be added when there is a canonical public home for the project.

---

## License

MIT — do whatever you want with it. Build companies on it.

---

## Acknowledgments

Fang stands on the shoulders of:

- **[A2A Protocol](https://github.com/a2aproject/A2A)** — Google + 146 enterprises agreed agents should talk to each other
- **[MCP](https://modelcontextprotocol.io)** — Anthropic + Linux Foundation, the standard for tool access
- **[pi](https://github.com/badlogic/pi-mono)** — Mario Zechner's brilliant, minimal, extensible coding harness
- **[aider](https://github.com/Aider-AI/aider)** — Paul Gauthier's git-native AI pair programmer
- **[OpenClaw](https://github.com/openclaw/openclaw)** — Peter Steinberger proved framing beats features

Every CLI agent listed above is built by brilliant people solving hard problems. None of them should be islands.

---

<div align="center">

<br/>

**Built for developers who use more than one agent**
**and refuse to orchestrate them manually.**

<br/>

[Get Started](#the-solution) · [Architecture](ARCHITECTURE.md) · [FANG-SPEC](docs/FANG-SPEC.md) · [Deployment](docs/DEPLOYMENT.md) · [Publishing](docs/PUBLISHING.md) · [Changelog](CHANGELOG.md) · [Contribute](CONTRIBUTING.md)

<br/>

</div>
