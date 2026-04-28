# `src/` — Legacy Single-File Build (Pre-Monorepo)

> **Note:** This directory contains the original single-file implementation from Fang's
> early development. It is preserved for reference but is **not the active codebase**.
>
> The live code lives in `packages/` (pnpm monorepo). See root [README.md](../README.md)
> and [ARCHITECTURE.md](../ARCHITECTURE.md) for the current architecture.
>
> If you're looking to add a new adapter, create it under `packages/adapters/<name>/`
> and follow the guide in [docs/ADAPTERS.md](../docs/ADAPTERS.md).

## What's Here

| File | Purpose |
|------|---------|
| `core.ts` | ProcessManager, PersistentProcess, LF-only JSONL reader, detectAdapters |
| `adapters.ts` | All 7 agent adapters (Pi, Claude, Codex, Gemini, Aider, OpenCode, Generic) |
| `server.ts` | A2A server wrapper (exposes wrapped agents to the network) |
| `client.ts` | A2A client (discover and call remote agents) |
| `bridge.ts` | Bridge executor (connects adapter pipeline to A2A server) |
| `index.ts` | Public API re-exports |
| `cli.ts` | CLI entry point (commander) |

## Historical Context

This was the initial implementation before the monorepo migration. The adapter API here
uses `parseLine()` instead of the monorepo's `parseOutput()`, and `AgentAdapter` instead
of `BaseAdapter`. Tests still run against this code (89 tests) but new development
should target the `packages/` structure.
