<div align="center">

```
███████╗ █████╗ ████████╗    ████████╗ █████╗ ███╗   ███╗
██╔════╝██╔══██╗╚══██╔══╝    ╚══██╔══╝██╔══██╗████╗ ████║
█████╗  ███████║   ██║          ██║   ███████║██╔████╔██║
██╔══╝  ██╔══██║   ██║          ██║   ██╔══██║██║╚██╔╝██║
██║     ██║  ██║   ██║          ██║   ██║  ██║██║ ╚═╝ ██║
╚═╝     ╚═╝  ╚═╝   ╚═╝          ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝
```

**Any CLI coding agent. A2A citizen. One command.** 🐺

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue?style=flat-square)](https://github.com/a2aproject/A2A)
[![Built on @a2a-js/sdk](https://img.shields.io/badge/built%20on-@a2a-js/sdk-green?style=flat-square)](https://www.npmjs.com/package/@a2a-js/sdk)
[![Node 24](https://img.shields.io/badge/node-24+-purple?style=flat-square)](https://nodejs.org)

</div>

---

## The Problem

Every CLI coding agent — `pi`, `claude-code`, `aider`, `codex`, `gemini`, `opencode`, `goose` — is powerful.

And every single one of them is an **island**.

```
pi → runs. does its job. disappears.
claude-code → runs. does its job. disappears.
aider → runs. does its job. disappears.
```

No orchestrator can discover them. No A2A system can delegate to them. They are **processes**, not **citizens**.

`fang` fixes this.

---

## The Solution

```bash
fang wrap "pi --mode rpc" --port 3001
```

That's it. `pi` is now:

- ✅ An **A2A-compliant agent** with a standard Agent Card
- ✅ **Discoverable** by any orchestrator
- ✅ **Callable** via JSON-RPC and REST
- ✅ **Streamable** — responses flow in real-time via SSE
- ✅ **Composable** — works with any A2A client

---

## Quickstart

```bash
git clone https://github.com/kariemSeiam/fang.git
cd fang
npm install

# Wrap any CLI agent
fang wrap "pi --mode rpc" --port 3001
fang wrap "claude" --port 3002
fang wrap "aider" --port 3003
fang wrap "codex --json" --port 3004
fang wrap "ollama run qwen2.5-coder" --port 3005

# Or start all from config
fang serve -c fang.yaml.example
```

## Test It

```bash
# Wrap cat as an A2A agent
fang wrap "cat" --port 3001 &

# Send a task via A2A JSON-RPC
curl -X POST http://localhost:3001/a2a/jsonrpc \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0", "id": "1", "method": "message/send",
    "params": {
      "message": {
        "messageId": "msg-1", "role": "user",
        "parts": [{"kind": "text", "text": "Hello from A2A!"}]
      }
    }
  }'
```

## Detect Installed Agents

```bash
fang detect
```

```
  🐺 Scanning for CLI agents...

  ✓ Claude Code     ⭐ Tier 1
    Binary: claude (1.0.0)
    Path:   /usr/local/bin/claude
    Mode:   oneshot
    Protocol: stream-json
    Skills: Complex reasoning, Code generation

  ✓ Pi              ⭐ Tier 1
    Binary: pi (0.1.0)
    Path:   /usr/local/bin/pi
    Mode:   persistent
    Protocol: jsonl-rpc
    Skills: Code any task, Refactor, Debug & fix
```

---

## How It Works

```
A2A Orchestrator (any)
 │
 │ A2A Protocol (JSON-RPC / REST / SSE)
 │
 ▼
 ┌──────────────────────────────┐
 │ fang                         │
 │ @a2a-js/sdk server           │
 │ BridgeExecutor (AgentExecutor)│
 │ ProcessManager / Persistent   │
 └──────────┬───────────────────┘
 │ stdin/stdout bridge
 ▼
 ┌──────────────────────────────┐
 │ pi --mode rpc / claude / any │
 └──────────────────────────────┘
```

---

## Supported Agents

| Agent | Tier | Protocol | Mode | Status |
|-------|:----:|----------|------|:------:|
| **Pi** | 1 | JSONL RPC | **Persistent** ✅ | ✅ |
| **Claude Code** | 1 | stream-json | Oneshot | ✅ |
| **Codex CLI** | 1 | JSONL | Oneshot | ✅ |
| **Aider** | 3 | Text + heuristics | Oneshot | ✅ |
| **Gemini CLI** | 2 | ACP (JSON-RPC) | Oneshot | ✅ |
| **OpenCode** | 2 | JSON output | Oneshot | ✅ |
| **Any CLI** | 3 | Text passthrough | Oneshot | ✅ |
| **Goose** | 2 | ACP | Oneshot | 🔜 |
| **SWE-agent** | 3 | Text | Oneshot | 🔜 |

### Tier System

- **Tier 1** — Native JSON/JSONL output → direct event parsing (Pi, Claude Code, Codex)
- **Tier 2** — ACP/JSON-RPC over stdio → protocol bridge (Gemini CLI, OpenCode)
- **Tier 3** — Text only → heuristic parsing (Aider, generic)

### Persistent Mode

Pi's `--mode rpc` is the gold standard — a long-lived process with bidirectional JSONL. Fang keeps Pi alive between tasks, preserving session context and warm caches. No other bridge does this.

---

## Client Library

```typescript
import { FangClient, discoverAgents } from 'fang';

// Discover what's running
const agents = await discoverAgents();
// [{ name: 'pi-agent', url: 'http://localhost:3001' }, ...]

// Send a task
const client = new FangClient('http://localhost:3001');
const result = await client.send('refactor src/auth.ts to use async/await');
console.log(result.text);
```

---

## CLI Reference

```bash
fang wrap <command> -p <port>   # Wrap a CLI as A2A server
fang serve [-c config.yaml]     # Start all agents from config
fang detect                     # Detect installed CLI agents
fang discover                   # Find running fang agents
fang send "<msg>" -p <port>     # Send a test task
fang card -p <port>             # Show agent card
```

---

## Architecture

```
src/
├── core.ts        # Types, ProcessManager, PersistentProcess, Detector
├── adapters.ts    # 7 adapters: Pi, Claude, Aider, Codex, Gemini, OpenCode, Generic
├── server.ts      # BridgeExecutor (AgentExecutor) + createFangServer
├── client.ts      # FangClient + discoverAgents
├── cli.ts         # Commander.js CLI with 6 commands
└── index.ts       # Re-exports everything
```

**Zero build.** Runs directly with Node.js 24's `--experimental-strip-types`.

Two execution models:
- **oneshot** — spawn per task, stdout = result, exit = done (Claude, Aider, Codex, etc.)
- **persistent** — spawn once, JSONL over stdin/stdout, keep alive (Pi `--mode rpc`)

Built on `@a2a-js/sdk` for all A2A protocol compliance:
- `DefaultRequestHandler` + `InMemoryTaskStore` for task management
- `agentCardHandler` for Agent Card serving
- `jsonRpcHandler` for JSON-RPC 2.0
- `restHandler` for HTTP+JSON/REST

---

## Why A2A over MCP?

CLI agents are **4–32× more token-efficient** than MCP-based approaches.

| Approach | Tokens/query | Monthly cost (10K ops) |
|----------|:-:|:-:|
| MCP | ~44,000 | ~$55 |
| CLI via fang | ~1,400 | ~$3 |

MCP injects tool schemas into every context window. GitHub's Copilot MCP burns ~55K tokens of schema per session. A2A uses lightweight Agent Cards (~500 bytes) and keeps agent internals internal.

---

## Token Economy

| Query | MCP tokens | CLI tokens | Savings |
|-------|:-:|:-:|:-:|
| "What language is this repo?" | 44,026 | 1,365 | **32×** |
| "Fix the auth bug" | ~50,000 | ~2,000 | **25×** |
| "Add tests for utils.ts" | ~38,000 | ~1,500 | **25×** |

*Sources: Scalekit 75-run benchmark, Anthropic engineering blog, Cloudflare "Code Mode" report.*

---

## Config

```yaml
# fang.yaml
agents:
  pi:
    cli: "pi --mode rpc"
    port: 3001
    timeout: 600

  claude:
    cli: "claude"
    port: 3002
    timeout: 300

  local:
    cli: "ollama run qwen2.5-coder"
    port: 3005
    timeout: 120
```

---

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

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contributions:

1. **New adapters** — wrap a CLI we don't support yet
2. **Bug reports** — tell us what breaks
3. **Examples** — show your multi-agent setup

---

## License

MIT

---

<div align="center">

Built for developers who use more than one agent
and refuse to switch between them manually.

**[GitHub](https://github.com/kariemSeiam/fang)**

🐺

</div>
