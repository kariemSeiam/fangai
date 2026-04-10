# A2A Protocol Compliance

> *How **Fang** (`@fangai/core`) implements the Agent-to-Agent protocol.*

---

## Protocol Version

Fang targets **A2A Protocol v1.0** as defined by the [A2A Project](https://github.com/a2aproject/A2A).

The full v1 specification defines multiple **bindings** (HTTP+JSON, JSON-RPC, gRPC) and a REST method table.

**Implementation (current):** `FangServer` mounts **`@a2a-js/sdk`** — `DefaultRequestHandler`, `InMemoryTaskStore`, `FangAgentExecutor` (CLI bridge), and Express middleware: `agentCardHandler`, `jsonRpcHandler` (mount: `POST /a2a`), `restHandler` (mount: `/v1/…` REST). Legacy hand-rolled routes **`/tasks/send`**, **`/tasks/:id`**, **`/tasks/:id/stream`** were **removed** in favor of this contract. Set **`FANG_PUBLIC_URL`** (e.g. `https://agent.example.com`) so the Agent Card URLs match your public origin.

The sections below retain example shapes; for normative behavior follow the [A2A spec](https://a2a-protocol.org/latest/specification/) and the SDK.

---

## Transport

| Layer | Choice | Why |
|-------|--------|-----|
| **Wire** | HTTP/1.1 | Universal, firewall-friendly, no special libraries needed |
| **Streaming** | Server-Sent Events (SSE) | Simpler than WebSocket, works through proxies, native browser support |
| **Encoding** | JSON | Universal, debuggable, matches A2A spec |
| **Framing** | LF-delimited | One JSON object per line for CLI ↔ adapter communication |

We deliberately avoid:
- WebSocket (adds complexity, proxy issues)
- gRPC (requires proto compilation, overkill for this use case)
- HTTP/2 (HTTP/1.1 is sufficient and more compatible)

---

## Endpoints

### `GET /.well-known/agent-card.json` (canonical) and `GET /.well-known/agent.json` (alias)

Returns the Agent Card — the discovery document that tells orchestrators who this agent is and what it can do. Both paths return the same JSON.

**Request:**
```
GET /.well-known/agent-card.json HTTP/1.1
Host: localhost:3001
```

**Response (200):**
```json
{
  "name": "pi-agent",
  "version": "1.0.0",
  "url": "http://localhost:3001",
  "description": "pi coding agent with full RPC observability",
  "capabilities": {
    "streaming": true,
    "async": true,
    "parallel_tasks": 4
  },
  "skills": [
    {
      "id": "typescript",
      "name": "TypeScript coding",
      "tags": ["ts", "javascript", "node", "web"]
    }
  ],
  "metadata": {
    "backend": "pi --mode rpc",
    "model": "glm-5.1",
    "cost_tier": "cheap",
    "framework": "pi",
    "observability": "full",
    "bridge": "fang",
    "fang_version": "0.1.0"
  }
}
```

**Compliance:** ✅ Fully compliant with A2A Agent Card specification.

---

### `POST /tasks/send` *(removed in current Fang)*

**Use instead:** `POST /a2a` JSON-RPC (`message/send`, …) or `POST /v1/message:send` REST. The following documents the old bridge shape only.

Submit a task to the agent. Returns immediately with a task ID (async pattern).

**Request:**
```
POST /tasks/send HTTP/1.1
Host: localhost:3001
Content-Type: application/json

{
  "id": "optional-custom-id",
  "message": {
    "parts": [
      {
        "type": "text",
        "text": "refactor src/auth.ts to use async/await"
      }
    ]
  }
}
```

**Response (200):**
```json
{
  "id": "task-uuid-here",
  "status": "submitted"
}
```

**Behavior:**
1. FangServer creates a task in `submitted` state
2. Spawns the CLI process in the background
3. Returns the task ID immediately (non-blocking)
4. CLI output is processed asynchronously
5. Clients can poll `GET /tasks/:id` or stream via `GET /tasks/:id/stream`

**Compliance:** ✅ Async task submission pattern as per A2A spec.

---

### `GET /tasks/:id`

Get the current status of a task.

**Request:**
```
GET /tasks/task-uuid-here HTTP/1.1
Host: localhost:3001
```

**Response (200) — Running:**
```json
{
  "id": "task-uuid-here",
  "status": "running",
  "message": "refactor src/auth.ts to use async/await",
  "updates": [
    { "type": "progress", "text": "Analyzing file structure..." },
    { "type": "log", "level": "info", "text": "🔧 read" },
    { "type": "progress", "text": "Found 3 callback patterns to convert..." }
  ],
  "createdAt": 1712736000000
}
```

**Response (200) — Completed:**
```json
{
  "id": "task-uuid-here",
  "status": "completed",
  "message": "refactor src/auth.ts to use async/await",
  "updates": [
    { "type": "progress", "text": "Analyzing file structure..." },
    { "type": "log", "level": "info", "text": "🔧 edit" },
    { "type": "progress", "text": "Converted 3 callbacks to async/await." },
    { "type": "complete" }
  ],
  "result": "Analyzing file structure... Converted 3 callbacks to async/await.",
  "createdAt": 1712736000000,
  "completedAt": 1712736045000
}
```

**Response (200) — Failed:**
```json
{
  "id": "task-uuid-here",
  "status": "failed",
  "message": "refactor src/auth.ts to use async/await",
  "updates": [
    { "type": "progress", "text": "Analyzing file structure..." },
    { "type": "failed", "text": "CLI exited with code 1" }
  ],
  "error": "CLI exited with code 1",
  "createdAt": 1712736000000,
  "completedAt": 1712736010000
}
```

**Response (404):**
```json
{
  "error": "not found"
}
```

**Note:** Tasks are garbage collected 60 seconds after completion. After that, `GET /tasks/:id` returns 404.

**Compliance:** ✅ Task status query as per A2A spec.

---

### `GET /tasks/:id/stream`

Stream task updates in real-time via Server-Sent Events.

**Request:**
```
GET /tasks/task-uuid-here/stream HTTP/1.1
Host: localhost:3001
Accept: text/event-stream
```

**Response (200):**
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"progress","text":"Analyzing file structure..."}

data: {"type":"log","level":"info","text":"🔧 read"}

data: {"type":"progress","text":"Found 3 callback patterns..."}

data: {"type":"log","level":"info","text":"🔧 edit"}

data: {"type":"progress","text":"Converted 3 callbacks to async/await."}

data: {"type":"complete","result":"Analyzing file structure... Converted 3 callbacks..."}

data: [DONE]
```

**Late joiners:** If you connect to the stream after the task has started, you receive all previous updates first (replay), then live updates going forward.

**Connection lifecycle:**
- Client connects → server replays existing updates → streams new updates
- Task completes → server sends `data: [DONE]` → keeps connection open for 60s
- Client disconnects → server removes subscriber → task continues
- Task is garbage collected → connection is closed

**Compliance:** ✅ SSE streaming as per A2A spec push notification mechanism.

---

### `GET /health`

Liveness and readiness check (Fang extension, not in A2A spec).

**Response (200):**
```json
{
  "status": "ok",
  "agent": "pi-agent",
  "activeTasks": 2,
  "uptime": 86400
}
```

Use this for:
- Kubernetes liveness probes
- Load balancer health checks
- Monitoring dashboards

---

### `DELETE /tasks/:id` (v0.2)

Cancel a running task. Kills the CLI process.

**Response (200):**
```json
{
  "id": "task-uuid-here",
  "status": "failed",
  "error": "cancelled by client"
}
```

**Compliance:** 🔶 Planned for v0.2.

---

## A2A Spec Mapping

| A2A Concept | Fang implementation |
|-------------|----------------------|
| **Agent** | One FangServer instance wrapping one CLI agent |
| **Agent Card** | Auto-generated at `/.well-known/agent.json` from config |
| **Task** | In-memory Task object managed by TaskManager |
| **Message** | The `message.parts[0].text` field from the POST body |
| **Task State** | `submitted` → `running` → `completed` / `failed` |
| **Streaming** | SDK SSE (`message/stream` via JSON-RPC, or REST streaming routes) |
| **Push Notification** | SSE (server-push to subscribed clients) |
| **Skill** | Derived from `--skills` CLI flag or `a2a.yaml` config |
| **Metadata** | Extended with `cost_tier`, `model`, `framework`, `observability` |

---

## Agent Card Extensions

Fang adds metadata beyond the standard A2A Agent Card:

| Field | Purpose | Values |
|-------|---------|--------|
| `metadata.cost_tier` | Economic routing hint | `free`, `cheap`, `paid`, `best` |
| `metadata.model` | Model identifier for orchestrators | Any model string |
| `metadata.framework` | Which CLI framework is wrapped | `pi`, `aider`, `claude`, `opencode`, `generic` |
| `metadata.observability` | How much detail the adapter provides | `full` (tool calls visible), `partial`, `minimal` |
| `metadata.fang_version` | Bridge version | Semver |

These extensions let orchestrators make intelligent routing decisions:
- Route quick edits → `free` or `cheap` agents
- Route architecture decisions → `best` agents with `full` observability
- Route sensitive code → `free` local agents (no API call leaves the machine)
- Route git-native work → agents with `git-native` skill

---

## Type Safety

Fang uses TypeScript throughout. The A2A types are defined in `@fangai/core`:

```typescript
// Task
interface Task {
  id: string;
  message: string;
}

// Task state
type TaskStatus = "submitted" | "running" | "completed" | "failed";

// Task update (streamed to SSE)
type TaskUpdate =
  | { type: "progress"; text: string }
  | { type: "complete"; result?: string }
  | { type: "failed"; text: string }
  | { type: "log"; level: "info" | "error"; text: string };

// Agent card
interface AgentCard {
  name: string;
  version: string;
  url: string;
  description?: string;
  capabilities: {
    streaming: boolean;
    async: boolean;
    parallel_tasks: number;
  };
  skills: Array<{ id: string; name: string; tags: string[] }>;
  metadata: Record<string, unknown>;
}
```

---

## Interoperability

### With A2A-JS Client

```typescript
import { A2AClient } from "@a2aproject/a2a-js";

const client = new A2AClient({ baseUrl: "http://localhost:3001" });

// Discover
const card = await client.getAgentCard();

// Send task
const task = await client.sendTask({
  message: { parts: [{ type: "text", text: "fix the bug" }] }
});

// Stream updates
for await (const update of client.streamTask(task.id)) {
  console.log(update);
}
```

### With LangGraph

```python
from langgraph.a2a import A2ATool

pi = A2ATool(url="http://localhost:3001")
result = pi.invoke("add unit tests for auth.ts")
```

### With CrewAI

```python
from crewai.a2a import A2AAgent

pi = A2AAgent(url="http://localhost:3001", role="coder")
crew = Crew(agents=[pi], tasks=[...])
crew.kickoff()
```

### With Raw HTTP (JSON-RPC)

```bash
# message/send (JSON-RPC)
curl -s -X POST http://localhost:3001/a2a \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":"1","method":"message/send","params":{"message":{"kind":"message","role":"user","messageId":"m1","parts":[{"kind":"text","text":"fix auth"}]}}}' | jq

# Task state (REST)
curl -s http://localhost:3001/v1/tasks/<task-id> | jq
```

---

## Future Compliance (Roadmap)

| Feature | A2A Spec | Fang target |
|---------|----------|---------------|
| Task cancellation | v1.0 | v0.2 |
| Webhook push notifications | v1.0 | v0.3 |
| Task history | v1.0 | v0.3 (persistent storage) |
| Agent authentication | v1.0 | v0.2 (API key header) |
| Multi-turn tasks | v1.1 | v0.3 (conversation mode) |
| Artifact exchange | v1.1 | v0.4 (file transfer) |

---

## See also

- **[`FANG-SPEC.md`](./FANG-SPEC.md)** — routes, executor, deferred items
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** — `FangServer` / SDK wiring; **See also** table to other docs
- **[`ADAPTERS.md`](./ADAPTERS.md)** — how stdout maps to A2A events

---

*Standards matter. Interoperability matters more.*
