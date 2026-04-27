# `src/` — FangAI Core (Canonical)

This is the canonical implementation of FangAI. All development happens here.

## Architecture

| File | Purpose |
|------|---------|
| `core.ts` | ProcessManager, PersistentProcess, LF-only JSONL reader, detectAdapters |
| `adapters.ts` | All 7 agent adapters (Pi, Claude, Codex, Gemini, Aider, OpenCode, Generic) |
| `server.ts` | A2A server wrapper (exposes wrapped agents to the network) |
| `client.ts` | A2A client (discover and call remote agents) |
| `bridge.ts` | Bridge executor (connects adapter pipeline to A2A server) |
| `index.ts` | Public API re-exports |
| `cli.ts` | CLI entry point (commander) |

## Adapters

Each adapter implements `AgentAdapter` from `core.ts`:
- `id` / `binary` / `tier` / `mode` — identity
- `buildArgs(task, config)` — CLI flags
- `formatInput(task)` — stdin payload
- `parseLine(line)` — stdout → `AdapterEvent[]`
- `detect()` — probe local system for installed binary

Tier system:
- **Tier 1**: Native JSONL/NDJSON (Pi, Claude, Codex)
- **Tier 2**: ACP protocol (Gemini)
- **Tier 3**: Text scraping (Aider, Generic)

## Tests

```bash
pnpm test
```

89 tests covering:
- JSONL reader (LF-only splitting, CRLF stripping, U+2028/U+2029 safety, buffered chunks)
- ProcessManager (spawn, stderr, exit codes, SIGTERM/SIGKILL, killAll)
- PersistentProcess (liveness, task routing, crash notification, extension UI auto-response)
- All 7 adapters (metadata, buildArgs, formatInput, parseLine edge cases)
- detectAdapter (exact match, path prefixes, false-positive rejection)
- FangClient (URL normalization, graceful failure)

## Note on `packages/`

The `packages/` directory contains a separate monorepo structure with its own adapter
implementations. That code is from an earlier iteration and uses a different API
(`parseOutput` vs `parseLine`, different `BaseAdapter` class). It is kept for
reference but should not be considered the source of truth.

If you're looking to add a new adapter, edit `src/adapters.ts` following the
existing patterns. See `PiAdapter` as the gold standard reference.
