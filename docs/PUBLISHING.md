# Publishing `@fangai/*` to npm

## Branding

**Fang** is the product name. **npm scope:** `@fangai` (register the org before first publish).

## Why not `fang` or `a2a-cli`?

- The unscoped name [`a2a-cli` on npm](https://www.npmjs.com/package/a2a-cli) is an existing **A2A client** (`@a2a-js/sdk`), not this bridge.
- The unscoped [`fang` package](https://www.npmjs.com/package/fang) may be taken or deprecated—scoped names avoid collisions.

**This repo publishes:**

| Package | Role |
|---------|------|
| `@fangai/cli` | User CLI (`fang` and compat alias `a2a-cli`) — [README](../packages/cli/README.md) |
| `@fangai/core` | FangServer, TaskManager, adapters registry — [README](../packages/core/README.md) |
| `@fangai/client` | Orchestrator client (`FangClient`, JSON-RPC helpers) — [README](../packages/client/README.md) |
| `@fangai/pi` | Pi adapter (`pi --mode rpc`) — [README](../packages/pi/README.md) |
| `@fangai/adapter-*` | Per-agent adapters — [ADAPTERS.md](./ADAPTERS.md) |

## Publish checklist

1. **`pnpm run release:verify`** (same as CI: build, test, `@fangai/core` lint). Update **`CHANGELOG.md`** — see **`spec/11-DISTRIBUTION-AND-PUBLISHING.md`** in the spec folder.
2. Semver bump across workspace packages you ship (keep versions aligned).
3. **`pnpm publish -r --access public`** from the monorepo root (with npm OTP if enabled); dependency order is handled automatically.
4. Tag the release in git (`vX.Y.Z`).
5. Optional: **`npm pack --dry-run`** inside a package directory to inspect the tarball. **`files`** in `package.json` limits shipped assets to **`dist/`**; npm still includes **README** and **LICENSE** from the package root when present.

## Install (after publish)

```bash
npm install -g @fangai/cli
fang wrap "pi --mode rpc" --port 3001
```

```bash
npx @fangai/cli wrap "pi --mode rpc" --port 3001
```

The **`a2a-cli`** binary name remains available as a **compat alias** for older scripts.

## See also

- **[`FANG-SPEC.md`](./FANG-SPEC.md)** — draft technical behavior aligned with the code.
- **[`ARCHITECTURE.md`](../ARCHITECTURE.md)** — what the published packages implement (diagrams, FAQ).
- **[`DEPLOYMENT.md`](./DEPLOYMENT.md)** — running agents after install.
- **[`../spec/11-DISTRIBUTION-AND-PUBLISHING.md`](../spec/11-DISTRIBUTION-AND-PUBLISHING.md)** — org-level distribution notes (semver, Docker, GitHub).
- **[`../CONTRIBUTING.md`](../CONTRIBUTING.md)** — local dev, `release:verify`, project layout.
- **[`../spec/16-RELEASE-CHECKLIST.md`](../spec/16-RELEASE-CHECKLIST.md)** — pre-tag smoke and security snapshot.
