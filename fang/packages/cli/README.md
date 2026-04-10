# @fangai/cli

**Fang** — wrap CLI coding agents (Pi, Aider, Claude, Codex, OpenCode, …) as [**A2A**](https://github.com/a2aproject/A2A) servers (`POST /a2a`, Agent Card, SSE).

## Install

```bash
npm install -g @fangai/cli
```

Binaries: **`fang`** and compat alias **`a2a-cli`**.

## Commands

| Command | Purpose |
|--------|---------|
| `fang wrap <command>` | Run a CLI behind the A2A HTTP server (alias: `serve`) |
| `fang start` | Start agents from `a2a.yaml` |
| `fang detect` | Suggest `wrap` commands for CLIs on `PATH` |
| `fang discover` | List running agents and health |
| `fang send` | Send a task to a running agent |
| `fang stop` | Stop agents |

## Docs

| Doc | Notes |
| --- | --- |
| **[Monorepo `README.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/README.md)** | Install, raw HTTP, deployment, roadmap |
| **[`docs/PUBLISHING.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/docs/PUBLISHING.md)** | `@fangai` scope, `pnpm publish`, tarball checks |
| **[`docs/FANG-SPEC.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/docs/FANG-SPEC.md)** | Technical behavior (routes, executor, CLI) |
| **[`CONTRIBUTING.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/CONTRIBUTING.md)** | Layout, tests, how to contribute |

Links follow `repository.directory` in this package’s `package.json`.
