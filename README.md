<div align="center">

```
 (               )         
 )\ )   (     ( /( (       
(()/(   )\    )\()))\ )    
 /(_)|(((_)( ((_)\\(()/(    
(_))_|)\ _ )\ _((_)/(_))_  
| |_  (_)_\(_) \| (_)) __| 
| __|  / _ \ | .` | | (_ | 
|_|   /_/ \_\|_|\_|  \___| 
```

**Every CLI agent is an island. Fang builds the bridge.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)
[![A2A Protocol](https://img.shields.io/badge/A2A-Protocol-blue?style=flat-square)](https://github.com/a2aproject/A2A)
[![Built on @a2a-js/sdk](https://img.shields.io/badge/built%20on-@a2a-js/sdk-green?style=flat-square)](https://www.npmjs.com/package/@a2a-js/sdk)
[![Node 24](https://img.shields.io/badge/node-24+-purple?style=flat-square)](https://nodejs.org)

</div>

---

## Manifesto

The best coding agents in the world — `pi`, `claude`, `aider`, `codex`, `gemini`, `opencode` — share one trait: they work alone. Each one is a powerful, self-contained process. You run it, it does the job, it disappears.

There is no discovery. No delegation. No protocol. No way for an orchestrator to say "you, do this" without wrapping each agent in custom glue code.

```
    pi ──?── orchestrator ──?── claude
    aider ──?──            ──?── codex
```

Every team that wants multi-agent workflows builds the same bridge from scratch. Over and over.

**Fang is that bridge, built once and built right.**

It wraps any CLI agent into an **A2A-compliant server** in one command. No plugins. No agent-side changes. No vendor lock-in. The agent doesn't even know it's been bridged.

```
    pi ──── Fang ──── A2A Protocol ──── orchestrator ──── A2A Protocol ──── Fang ──── claude
  aider ──── Fang ──── A2A Protocol ────             ──── A2A Protocol ──── Fang ──── codex
```

---

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
fang wrap "codex --json"     --port 3003   # oneshot JSONL
fang wrap "opencode run"     --port 3004   # oneshot JSON
fang wrap "aider --json"     --port 3005   # oneshot JSON mode

# Or start them all at once
fang serve -c fang.yaml
```

---

## Test It in 30 Seconds

```bash
# 1. Wrap even `cat` as an A2A agent
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

---

## Detect Installed Agents

```bash
fang detect
```

```
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

---

## How It Works

```
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

**The core insight:** Every CLI agent reads stdin and writes stdout. That interface is older than HTTP, older than JSON, older than every protocol since the terminal itself. Fang translates between that universal interface and A2A. Nothing more, nothing less.

---

## Supported Agents

| Agent | Tier | Protocol | Mode | Status |
|-------|:----:|----------|------|:------:|
| **Pi** | 1 | JSONL RPC | **Persistent** | ✅ |
| **Claude Code** | 1 | stream-json | Oneshot | ✅ |
| **Codex CLI** | 1 | JSONL | Oneshot | ✅ |
| **Gemini CLI** | 2 | ACP (JSON-RPC) | Oneshot | ✅ |
| **OpenCode** | 2 | JSON output | Oneshot | ✅ |
| **Aider** | 3 | Text + heuristics | Oneshot | ✅ |
| **Any CLI** | 3 | Text passthrough | Oneshot | ✅ |
| **Goose** | 2 | ACP | Oneshot | 🔜 |
| **SWE-agent** | 3 | Text | Oneshot | 🔜 |

### Tier System

- **Tier 1** — Native JSON/JSONL output. Direct event parsing. Zero ambiguity. (Pi, Claude Code, Codex)
- **Tier 2** — Structured protocol over stdio. Protocol bridge with known schema. (Gemini CLI, OpenCode)
- **Tier 3** — Text only. Heuristic parsing. Best-effort. (Aider, generic fallback)

### Persistent Mode

Pi's `--mode rpc` is the gold standard — a long-lived process with bidirectional JSONL. Fang keeps Pi alive between tasks, preserving session context and warm caches. No other bridge does this.

---

## Why A2A over MCP?

CLI agents are **4–32× more token-efficient** than MCP-based approaches.

| Approach | Tokens/query | Monthly cost (10K ops) |
|----------|:-:|:-:|
| MCP | ~44,000 | ~$55 |
| CLI via fang | ~1,400 | ~$3 |

MCP injects tool schemas into every context window. GitHub's Copilot MCP burns ~55K tokens of schema per session. A2A uses lightweight Agent Cards (~500 bytes) and keeps agent internals internal.

---

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

---

## CLI Reference

```
fang wrap <command> -p <port>   Wrap any CLI as an A2A server
fang serve [-c config.yaml]     Start all agents from config
fang detect                     Detect installed CLI agents
fang discover                   Find running Fang agents on the network
fang send "<msg>" -p <port>     Send a task to a wrapped agent
fang stop [-p <port> | --all]   Stop one or all wrapped agents
```

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
    cli: "claude --print"
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

## Architecture

```
packages/
├── core/           FangServer, FangAgentExecutor, BaseAdapter, ProcessManager
├── client/         @fangai/client — FangClient + discoverAgents
├── cli/            @fangai/cli — CLI entry point (6 commands)
├── pi/             @fangai/pi — Pi JSONL RPC adapter
└── adapters/
    ├── claude/     Claude Code text stream adapter
    ├── codex/      Codex CLI JSONL adapter
    ├── opencode/   OpenCode JSON output adapter
    ├── aider/      Aider JSON mode adapter
    └── generic/    Generic text passthrough (catches everything else)
```

**pnpm monorepo.** Each package is independently publishable.

Two execution models:
- **oneshot** — spawn per task, stdout = result, exit = done (Claude, Aider, Codex, etc.)
- **persistent** — spawn once, JSONL over stdin/stdout, keep alive between tasks (Pi `--mode rpc`)

Built on `@a2a-js/sdk` for full A2A protocol compliance:
- `DefaultRequestHandler` + `InMemoryTaskStore` for task lifecycle
- `agentCardHandler` for Agent Card serving
- `jsonRpcHandler` for JSON-RPC 2.0
- `restHandler` for HTTP+JSON/REST

Full internals: [ARCHITECTURE.md](ARCHITECTURE.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contributions:

1. **New adapters** — wrap a CLI agent we don't support yet
2. **Bug reports** — tell us what breaks
3. **Examples** — show your multi-agent setup

---

## Documentation

| Doc | What |
|-----|------|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design, data flow, security model, adapter guide |
| [docs/ADAPTERS.md](docs/ADAPTERS.md) | Writing new adapters (full walkthrough) |
| [docs/A2A-COMPLIANCE.md](docs/A2A-COMPLIANCE.md) | A2A protocol compliance details |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment guide |
| [docs/FANG-SPEC.md](docs/FANG-SPEC.md) | Implementation spec |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | npm publishing process |
| [CHANGELOG.md](CHANGELOG.md) | Release history |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## License

MIT

---

<div align="center">

```
   /\_/\      Built for developers who use more than one agent
  / o o \     and refuse to build the same bridge twice.
 (  >.<  )
  \  ~  /
   \_O_/
```

**[GitHub](https://github.com/kariemSeiam/fangai)**

</div>
