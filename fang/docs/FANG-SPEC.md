# Fang — Technical specification (draft v0.1)

**Status:** First-step implementation spec. Describes what the repo **does today**, what it **intends** to do, and explicit **non-goals** / **gaps**. Update this file when behavior changes.

**Audience:** Implementers, reviewers, and future maintainers. Not a marketing document.

---

## 1. Problem statement

**Fang** is a **CLI subprocess → A2A v1 server** bridge. A long-running HTTP server:

- Accepts A2A requests (`@a2a-js/sdk` contract).
- Runs the wrapped agent via **oneshot spawn**, **persistent stdin/stdout** (e.g. Pi RPC), or **OpenCode HTTP** when configured — see **`FangAgentExecutor`**.
- Writes the user message to **stdin** (or the OpenCode SDK) per adapter contract.
- Maps **stdout/stderr** lines to **task artifact** and **status** events (or OpenCode events) until completion, timeout, or cancel.

No other product in this repo is required for that core loop: **`@fangai/core`** + an installed **adapter package** + a **CLI binary** on `PATH`.

---

## 2. Architectural decisions (locked for v0.1)

| Decision | Choice | Rationale |
|----------|--------|-----------|
| A2A implementation | **`@a2a-js/sdk`** | Official server stack: `DefaultRequestHandler`, `InMemoryTaskStore`, `DefaultExecutionEventBusManager`, Express middleware. |
| HTTP framework | **Express 4** | SDK ships `jsonRpcHandler`, `restHandler`, `agentCardHandler` for Express. |
| Package layout | **`@fangai/core`** hosts server + executor | No separate `@fangai/server` package yet; avoids duplicating SDK wiring. |
| Module system | **ESM** (`"type": "module"`) | Aligns with SDK and modern Node. |
| Auth (HTTP) | **Optional API key** (`FangConfig.apiKey` / `FANG_API_KEY`) | `apiKeyGate` protects `/a2a` and REST; **`/.well-known`** and **`/health`** stay public. SDK still uses `UserBuilder.noAuthentication`; Agent Card does not yet declare `securitySchemes`. |
| Task store | **`InMemoryTaskStore`** | Ephemeral; process restart loses tasks. |

**Explicitly deferred (not “wrong,” just not done):** Hono, tsup, Turborepo, persistent task store, SSE proxy heartbeats, subprocess supervision (restart on crash), Agent Card **`securitySchemes`** for API keys.

---

## 3. Runtime surfaces

### 3.1 HTTP routes (FangServer)

| Method / path | Purpose |
|---------------|---------|
| `GET /.well-known/agent-card.json` | Agent Card (also legacy alias `/.well-known/agent.json`). |
| `POST /a2a` | JSON-RPC 2.0 (`message/send`, `message/stream`, task methods per SDK). |
| `GET /health` | Fang-specific liveness JSON (`status`, `agent`, `bridge`, `sdk`, `uptime`). |
| `/*` (SDK `restHandler`) | HTTP+JSON REST mapping for A2A operations (paths under `/v1/…` per SDK). |

**Public URL:** `FANG_PUBLIC_URL` env, else `http://localhost:<port>`. Used when building Agent Card URLs so clients behind reverse proxies get correct links.

### 3.2 CLI (`@fangai/cli`, binary `fang`)

| Command | Role |
|---------|------|
| `fang wrap <command>` (alias: `fang serve`) | Build `FangConfig`, `detectAdapter(cli)`, start `FangServer`. |
| `fang send` | JSON-RPC client to `POST …/a2a` — `message/stream` (default) or `message/send`. |
| `fang start` | Multi-agent from config file (`a2a.yaml` pattern). |
| `fang detect` | List installed CLIs and suggested **`fang wrap …`** lines (`hostDetect`). |
| `fang discover` / `fang stop` | Discover running agents / shut down helpers. |

**Adapter pick:** `fang wrap` uses **`detectAdapter(cli)`** to choose an **`@fangai/adapter-*`** package for the command string.

---

## 4. Core data flow

### 4.1 `FangConfig` (packages/core `index.ts`)

Meaningful fields today:

- **`cli`**: Full command string; first token is `spawn` executable, rest are base args (e.g. `pi --mode rpc`).
- **`args`**: Optional extra argv appended after `cli` split (rarely used from CLI).
- **`port`**, **`host`**, **`name`**, **`specializations`** (skills), **`timeout`** (seconds, default 300).
- **`apiKey`**: Optional; with `FANG_API_KEY` gates `/a2a` and REST.
- **`openCodeServeUrl`** (+ password / directory): Optional OpenCode HTTP bridge instead of spawning the CLI.
- **`costTier`**, **`model`**, **`maxParallel`**: Present in config; **`maxParallel` is not enforced** by `FangAgentExecutor` in the current code (parallelism is effectively “whatever the SDK schedules”; risk of multiple concurrent subprocesses if the SDK allows).

### 4.2 Adapter contract (`BaseAdapter`)

| Method | Contract |
|--------|----------|
| `formatInput(task: Task)` | Encodes `Task.message` (and implicit `task.id`) for **one-shot** stdin write; stdin is **ended** after first write. |
| `parseOutput(line: string)` | **One line** of stdout → `TaskUpdate` or `null`. Line buffering assumes `\n` delimiters; trailing partial line flushed on process `exit`. |
| `static canHandle(cli: string)` | Registry order: Pi → Aider → Claude → OpenCode → Generic (always true). |

**`TaskUpdate` union:** `progress` | `complete` | `failed` | `log`. Executor maps these to SDK events (see below).

**Modes:** **Oneshot** — one process per task, one stdin write, drain until exit. **Persistent** (e.g. Pi `--mode rpc`) — one shell; tasks serialized (second task while busy fails). **OpenCode HTTP** — no local CLI spawn when `openCodeServeUrl` is set.

### 4.3 `FangAgentExecutor` (implements SDK `AgentExecutor`)

- Extracts **text** from `RequestContext.userMessage.parts` only where `kind === "text"`. **File / data parts are ignored** unless future work adds them.
- Publishes **`working`** status, then streams:
  - **`progress`** → `TaskArtifactUpdateEvent` (artifact name `stdout`).
  - **`log`** → artifact named by level.
  - **`stderr`** → always artifact `stderr` (raw chunks).
- **`failed`** from adapter → fatal: kill process, `failed` status, `eventBus.finished()`, resolve execution.
- **`complete`** → no artifact by itself; completion is driven by process **exit** (see below).
- On **exit:** non-zero exit → `failed` with message; zero → `completed`. Flushes buffered stdout line once.
- **Timeout:** `SIGTERM`, cleanup, `failed` status, `finished`.
- **`cancelTask`:** `SIGTERM`, `canceled`, `finished`.
- **`killAll`:** on server `stop()`.

**SDK responsibility:** Task lifecycle, SSE framing, JSON-RPC method routing, and `tasks/*` behavior come from `@a2a-js/sdk`. Fang only implements **`execute`** and **`cancelTask`** faithfully.

---

## 5. Agent Card

Built by **`buildSdkAgentCard`** (`sdkAgentCard.ts`):

- **`url`** / JSON-RPC: `{publicBase}/a2a`
- **`preferredTransport`:** `JSONRPC`
- **`additionalInterfaces`:** HTTP+JSON at base, JSON-RPC at `/a2a`
- **`capabilities.streaming`:** `true` (actual streaming depends on client method and SDK)
- **`skills`:** from `config.specializations`

Version fields are static **`0.1.0`** / protocol **`1.0`** in code; align with npm releases when publishing.

---

## 6. Adapters shipped in-repo

| Package | Detection heuristic | Notes |
|---------|---------------------|--------|
| `@fangai/pi` | `pi` + `--mode rpc` | JSON lines; `done` / `error` mapped. |
| `@fangai/adapter-aider` | command starts with `aider` | JSON preferred; falls back to plain lines as progress. |
| `@fangai/adapter-claude` | `claude` in command | NDJSON / `stream_event` + `text_delta`; plain lines + ANSI strip. |
| `@fangai/adapter-codex` | `codex` in command | `codex --json` JSONL. |
| `@fangai/adapter-opencode` | `opencode` in command | JSON lines / `opencode serve` HTTP via config. |
| `@fangai/adapter-generic` | always | Last resort; line-by-line progress. |

**Not present as dedicated packages:** Amp, Gemini (ACP), Goose, Crush — **roadmap** / deferred (see `spec/05`).

---

## 7. Legacy / dual API surface

`packages/core/src/index.ts` still exports **legacy** helpers (`TaskManager`, `SSEEmitter`, `buildAgentCard` from `AgentCard.ts`) alongside the SDK path. New work should use **`FangServer` + `buildSdkAgentCard`**. A future minor release may deprecate or remove legacy exports once tests and docs are clean.

---

## 8. Non-goals (v0.1)

- Replacing each vendor’s **internal** tool protocol with MCP.
- Guaranteeing **feature parity** with vendor CLIs (permissions, IDE mode, interactive TUI).
- **Proving** token multipliers; that remains **positioning / external benchmarks**, not a runtime metric in Fang.
- Shipping **Gemini-only** or **single-vendor** lock-in — Fang stays **adapter-per-CLI** and **vendor-neutral**.

---

## 9. Risk register (honest)

| Risk | Mitigation direction |
|------|----------------------|
| CLI output shape drift (especially Claude stream-json) | Versioned adapters, fixture tests on sample NDJSON lines. |
| Single-shot stdin vs true RPC | Document; add `PersistentSessionExecutor` only if product requires it. |
| Unbounded stderr / stdout | Optional line length caps, rate limits (not implemented). |
| `maxParallel` ignored | Enforce queue in executor or document removal from config. |
| Auth only at HTTP edge | Optional **`FANG_API_KEY`** / `--api-key`; Agent Card remains public — use reverse proxy or **`--host 127.0.0.1`** for stricter deployments (`spec/14`). |

---

## 10. Definition of “Fang v1.0 ready” (proposal)

When **all** of the following are true, consider promoting from “draft spec” to “1.0”:

1. **Auth story** — API key on `/a2a` + REST **done**; optional **Agent Card `securitySchemes`** + SDK `UserBuilder` alignment still open.
2. **Concurrency** — `maxParallel` enforced or removed from user-facing config.
3. **Tier-1 coverage** — Documented, tested adapters for **Claude** + **Pi** + one **ACP** agent (e.g. Gemini or Goose) *or* explicit waiver with roadmap dates.
4. **CLI UX** — `fang detect` / `fang discover` documented in README; keep parity with **host detection** tiers.
5. **Legacy cleanup** — Legacy exports deprecated or removed; single mental model for integrators.

---

## See also

- **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** — diagrams, FAQ, **See also** hub
- **[`A2A-COMPLIANCE.md`](./A2A-COMPLIANCE.md)** — protocol mapping and examples
- **[`PUBLISHING.md`](./PUBLISHING.md)** — `@fangai/*` release process
- **[`ADAPTERS.md`](./ADAPTERS.md)** — adapter API and registry

---

## 11. Document control

| Version | Date | Notes |
|---------|------|-------|
| 0.1 (draft) | 2026-04-10 | Initial spec from codebase audit. |

**Maintainer instruction:** Any PR that changes routes, executor semantics, or adapter contract should update **this file** in the same PR.
