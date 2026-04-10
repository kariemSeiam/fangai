# @fangai/pi

**Pi** coding agent support for [Fang](https://github.com/kariemSeiam/fangai/blob/main/fang/README.md) — the CLI → A2A bridge.

## When you need this

Install `@fangai/pi` alongside `@fangai/core` / `@fangai/cli` when your wrapped command is Pi in RPC mode:

```bash
pi --mode rpc
```

Fang auto-selects this adapter when the command string matches Pi with `--mode rpc`.

## What it does

Maps Pi’s **LF-delimited JSON** on stdout into Fang’s `TaskUpdate` stream (`progress`, `log`, `complete`, `failed`). User messages are sent as a single JSON line on stdin per task — same contract as the rest of Fang’s subprocess bridge.

## Try it

```bash
fang wrap "pi --mode rpc" --port 3001 --name pi-agent
```

## See also

- **[`docs/ADAPTERS.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/docs/ADAPTERS.md)** — adapter contract and registry
- **[`docs/PUBLISHING.md`](https://github.com/kariemSeiam/fangai/blob/main/fang/docs/PUBLISHING.md)** — publishing `@fangai/*`

## Dev

From the monorepo root:

```bash
pnpm --filter @fangai/pi test
pnpm --filter @fangai/pi build
```

MIT — same as Fang.
