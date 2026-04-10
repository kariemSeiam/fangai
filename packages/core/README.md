# @fangai/core

**Fang** runtime: [**A2A v1**](https://github.com/a2aproject/A2A) HTTP server (`FangServer`) and **`FangAgentExecutor`** (stdin/stdout or OpenCode HTTP bridge), built on [`@a2a-js/sdk`](https://www.npmjs.com/package/@a2a-js/sdk).

## Install

Used as a library (the **`@fangai/cli`** package depends on it):

```bash
npm install @fangai/core
```

You typically also install one or more **`@fangai/adapter-*`** packages and a **`@fangai/pi`** if you wrap Pi RPC.

## Public API (entry: `dist/index.js`)

| Export | Role |
|--------|------|
| `FangServer` | Express app + SDK handlers (`POST /a2a`, Agent Card, REST, `/health`) |
| `FangAgentExecutor` | `AgentExecutor` implementation — subprocess or OpenCode SDK |
| `FangConfig`, `Task`, `AgentCard`, … | Types and config |
| `detectAdapter` | Pick an adapter from the CLI command string |
| `detectHostAgents` | Scan `PATH` for known agents (used by `fang detect`) |
| `buildAgentCard` / `buildSdkAgentCard` | Agent Card helpers |
| `TaskManager`, `SSEEmitter` | Task lifecycle / streaming utilities |
| `apiKeyGate`, `extractApiKeyFromRequest` | Optional HTTP API key gate |
| `BaseAdapter` | Base class for adapters in separate packages |

## Docs

- **[`docs/FANG-SPEC.md`](https://github.com/kariemSeiam/fangai/blob/main/docs/FANG-SPEC.md)** — behavior and surfaces
- **[`ARCHITECTURE.md`](https://github.com/kariemSeiam/fangai/blob/main/ARCHITECTURE.md)** — diagrams and SDK wiring
- **[`docs/ADAPTERS.md`](https://github.com/kariemSeiam/fangai/blob/main/docs/ADAPTERS.md)** — writing adapters
- **[`docs/PUBLISHING.md`](https://github.com/kariemSeiam/fangai/blob/main/docs/PUBLISHING.md)** — npm publish checklist (`@fangai/*`)
