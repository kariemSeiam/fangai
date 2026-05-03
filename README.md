<div align="center">

```text
 ███████╗███████╗
 ██╔════╝██╔════╝
 █████╗  █████╗
 ██╔══╝  ██╔══╝
 ██║     ███████╗
 ╚═╝     ╚══════╝
```

### Every CLI agent is an island. Fang builds the bridge.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-0A66C2?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgd2lkdGg9IjE0IiBoZWlnaHQ9IjE0IiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTEyIDJDNi40OCAyIDIgNi40OCAyIDEyczQuNDggMTAgMTAgMTAgMTAtNC40OCAxMC0xMFMxNy41MiAyIDEyIDJ6bS0xIDE3LjkzYy0zLjk1LS40OS03LTMuOTUtNy03LjkzczMuMDUtNy40NCA3LTcuOTN2MTUuODZ6Ii8+PC9zdmc+)](https://github.com/a2aproject/A2A)
[![npm @fangai/core](https://img.shields.io/badge/npm-@fangai%2Fcore-CB3847?style=flat-square&logo=npm)](https://www.npmjs.com/package/@fangai/core)
[![Node 24+](https://img.shields.io/badge/node-24+-339933?style=flat-square&logo=node.js)](https://nodejs.org)

<sup>Wrap any CLI coding agent into an A2A server — one command. Zero plugins. Zero lock-in.</sup>

</div>

<br>

---

<br>

<details>
<summary><strong>Table of Contents</strong></summary>

- [Manifesto](#manifesto)
- [One Command](#one-command)
- [Test It in 30 Seconds](#test-it-in-30-seconds)
- [Detect Installed Agents](#detect-installed-agents)
- [How It Works](#how-it-works)
- [Supported Agents](#supported-agents)
- [Why A2A over MCP?](#why-a2a-over-mcp)
- [Client Library](#client-library)
- [CLI Reference](#cli-reference)
- [Config](#config)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [Documentation](#documentation)
- [License](#license)

</details>

<br>

---

<br>

## Manifesto

The best coding agents in the world — `pi`, `claude`, `cursor-agent`, `aider`, `codex`, `gemini`, `opencode` — share one trait:

**They work alone.**

Each one is a powerful, self-contained process. You run it, it does the job, it disappears.

No discovery. No delegation. No protocol. No way for an orchestrator to say *you, do this* without wrapping each agent in custom glue code.

```text
  pi ──?── orchestrator ──?── claude
  aider ──?──           ──?── codex
```

Every team that wants multi-agent workflows builds the same bridge from scratch. Over and over.

**Fang is that bridge, built once and built right.**

It wraps any CLI agent into an **A2A-compliant server** in one command. No plugins. No agent-side changes. No vendor lock-in. The agent doesn't even know it's been bridged.

```text
  pi ──── Fang ──── A2A ──── orchestrator ──── A2A ──── Fang ──── claude
  aider ── Fang ──── A2A ────               ──── A2A ──── Fang ──── codex
```

<br>

---

<br>

## One Command

```bash
fang wrap "claude --print" --port 3001
```

That's it. `claude` is now:

- **Discoverable** — standard A2A Agent Card at `/.well-known/agent-card.json`
- **Callable** — JSON-RPC 2.0 and REST endpoints
- **Streamable** — real-time SSE updates as the agent works
- **Composable** — any A2A client can delegate to it

```bash
# Wrap multiple agents
fang wrap "pi --mode rpc"    --port 3001   # persistent JSONL RPC
fang wrap "claude --print"   --port 3002   # oneshot text stream
fang wrap "cursor-agent --print --output-format stream-json --yolo --trust" --port 3003   # cursor agent
fang wrap "codex --json"     --port 3004   # oneshot JSONL
fang wrap "opencode run"     --port 3005   # oneshot JSON
fang wrap "aider --json"     --port 3006   # oneshot JSON mode

# Or start them all at once
fang serve -c fang.yaml
```

<br>

---

<br>

## Test It in 30 Seconds

```bash
# 1. Wrap even cat as an A2A agent
fang wrap "cat" --port 3001 &

# 2. Send a task
fang send "Hello from A2A" --port 3001

# 3. Or raw JSON-RPC
curl -X POST http://localhost:3001/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": {
      "message": {
        "messageId": "m1", "role": "user",
        "parts": [{"kind": "text", "text": "Hello from A2A!"}]
      }
    }
  }'
```

<br>

---

<br>

## Detect Installed Agents

```bash
fang detect
```

```text
  Scanning for CLI agents...

  ✓ Claude Code     Tier 1
    Binary: claude (1.0.0)
    Path:   /usr/local/bin/claude
    Mode:   oneshot
    Protocol: stream-json
    Skills: Complex reasoning, Code generation

  ✓ Pi              Tier 1
    Binary: pi (0.1.0)
    Path:   /usr/local/bin/pi
    Mode:   persistent
    Protocol: jsonl-rpc
    Skills: Code any task, Refactor, Debug & fix
```

<br>

---

<br>

## How It Works

```text
                      ANY A2A ORCHESTRATOR
                             │
                  JSON-RPC 2.0 / REST / SSE
                             │
                             ▼
                ┌────────────────────────────┐
                │         FangServer          │
                │     (@a2a-js/sdk + Express)  │
                │                              │
                │  FangAgentExecutor           │
                │  Adapter (agent-specific)    │
                │  ProcessManager              │
                └────────────┬─────────────────┘
                             │
                       stdin / stdout
                             │
                             ▼
                ┌────────────────────────────┐
                │   pi / claude / aider / any │
                └────────────────────────────┘
```

> [!NOTE]
> **The core insight:** Every CLI agent reads stdin and writes stdout. That interface is older than HTTP, older than JSON — older than every protocol since the terminal itself. Fang translates between that universal interface and A2A. Nothing more, nothing less.

<br>

---

<br>

## Supported Agents

| Agent | Tier | Protocol | Mode | Status |
|:------|:----:|:---------|:-----|:------:|
| **Pi** | 1 | JSONL RPC | **Persistent** | ✅ |
| **Claude Code** | 1 | stream-json | Oneshot | ✅ |
| **Cursor Agent** | 1 | stream-json | Oneshot | ✅ |
| **Codex CLI** | 1 | JSONL | Oneshot | ✅ |
| **Gemini CLI** | 2 | ACP (JSON-RPC) | Oneshot | ✅ |
| **OpenCode** | 2 | JSON output | Oneshot | ✅ |
| **Aider** | 3 | Text + heuristics | Oneshot | ✅ |
| **Any CLI** | 3 | Text passthrough | Oneshot | ✅ |
| **Goose** | 2 | ACP | Oneshot | 🔜 |
| **SWE-agent** | 3 | Text | Oneshot | 🔜 |

<details>
<summary><strong>Tier System</strong></summary>

- **Tier 1** — Native JSON/JSONL output. Direct event parsing. Zero ambiguity. *(Pi, Claude Code, Cursor Agent, Codex)*
- **Tier 2** — Structured protocol over stdio. Protocol bridge with known schema. *(Gemini CLI, OpenCode)*
- **Tier 3** — Text only. Heuristic parsing. Best-effort. *(Aider, generic fallback)*

</details>

<details>
<summary><strong>Persistent Mode</strong></summary>

Pi's `--mode rpc` is the gold standard — a long-lived process with bidirectional JSONL. Fang keeps Pi alive between tasks, preserving session context and warm caches. No other bridge does this.

</details>

<br>

---

<br>

## Why A2A over MCP?

CLI agents are **4-32x more token-efficient** than MCP-based approaches.

| Approach | Tokens/query | Monthly cost (10K ops) |
|:---------|:------------:|:----------------------:|
| MCP | ~44,000 | ~$55 |
| CLI via fang | ~1,400 | ~$3 |

> [!IMPORTANT]
> MCP injects tool schemas into every context window. GitHub's Copilot MCP burns ~55K tokens of schema per session. A2A uses lightweight Agent Cards (~500 bytes) and keeps agent internals internal.

<br>

---

<br>

## Client Library

```typescript
import { FangClient, discoverAgents } from '@fangai/client';

// Discover what's running
const agents = await discoverAgents();
// [{ name: 'pi-agent', url: 'http://localhost:3001' }, ...]

// Send a task
const client = new FangClient('http://localhost:3001');
const result = await client.send('refactor src/auth.ts to use async/await');
console.log(result.text);
```

<br>

---

<br>

## CLI Reference

```text
fang wrap <command> -p <port>   Wrap any CLI as an A2A server
fang serve [-c config.yaml]     Start all agents from config
fang detect                     Detect installed CLI agents
fang discover                   Find running Fang agents on the network
fang send "<msg>" -p <port>     Send a task to a wrapped agent
fang stop [-p <port> | --all]   Stop one or all wrapped agents
```

<br>

---

<br>

## Config

```yaml
# fang.yaml
agents:
  pi:
    cli: "pi --mode rpc"
    port: 3001
    timeout: 600

  claude:
    cli: "claude --print"
    port: 3002
    timeout: 300

  cursor:
    cli: "cursor-agent --print --output-format stream-json --stream-partial-output --yolo --trust"
    port: 3003
    timeout: 300

  local:
    cli: "ollama run qwen2.5-coder"
    port: 3005
    timeout: 120
```

<br>

---

<br>

## Deployment

### Docker

```bash
docker-compose up -d
```

### systemd

```bash
sudo cp systemd/fang@.service /etc/systemd/system/
sudo systemctl enable fang@"pi --mode rpc"
sudo systemctl start fang@"pi --mode rpc"
```

<br>

---

<br>

## Architecture

```text
packages/
├── core/           FangServer, FangAgentExecutor, BaseAdapter, ProcessManager
├── client/         @fangai/client — FangClient + discoverAgents
├── cli/            @fangai/cli — CLI entry point (6 commands)
├── pi/             @fangai/pi — Pi JSONL RPC adapter
└── adapters/
    ├── claude/     Claude Code text stream adapter
    ├── cursor/     Cursor Agent CLI stream-json adapter
    ├── codex/      Codex CLI JSONL adapter
    ├── opencode/   OpenCode JSON output adapter
    ├── aider/      Aider JSON mode adapter
    └── generic/    Generic text passthrough (catches everything else)
```

> **pnpm monorepo.** Each package is independently publishable.

Two execution models:
- **oneshot** — spawn per task, stdout = result, exit = done *(Claude, Aider, Codex, etc.)*
- **persistent** — spawn once, JSONL over stdin/stdout, keep alive between tasks *(Pi `--mode rpc`)*

Built on `@a2a-js/sdk` for full A2A protocol compliance:
- `DefaultRequestHandler` + `InMemoryTaskStore` for task lifecycle
- `agentCardHandler` for Agent Card serving
- `jsonRpcHandler` for JSON-RPC 2.0
- `restHandler` for HTTP+JSON/REST

Full internals: **[ARCHITECTURE.md](ARCHITECTURE.md)**

<br>

---

<br>

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)**. The most valuable contributions:

1. **New adapters** — wrap a CLI agent we don't support yet
2. **Bug reports** — tell us what breaks
3. **Examples** — show your multi-agent setup

<br>

---

<br>

## Documentation

| Doc | What |
|:----|:-----|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design, data flow, security model, adapter guide |
| [ADAPTERS.md](docs/ADAPTERS.md) | Writing new adapters (full walkthrough) |
| [A2A-COMPLIANCE.md](docs/A2A-COMPLIANCE.md) | A2A protocol compliance details |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment guide |
| [FANG-SPEC.md](docs/FANG-SPEC.md) | Implementation spec |
| [PUBLISHING.md](docs/PUBLISHING.md) | npm publishing process |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

<br>

---

<br>

## License

[MIT](LICENSE) — do what you want.

<br>

---

<br>

<div align="center">

```text
   /\_/\      Built for developers who use more than
  ( o.o )     one agent and refuse to build the same
   > ^ <      bridge twice.
```

**[kariemSeiam/fangai](https://github.com/kariemSeiam/fangai)**

<sub>Every commit howls. 🐺</sub>

</div>
