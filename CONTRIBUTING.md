# Contributing to Fang (`@fangai/*`)

First: thank you. Every adapter, bug fix, and doc improvement makes the bridge stronger for everyone.

---

## Quick Start

```bash
git clone https://github.com/kariemSeiam/fangai.git
cd fangai
pnpm install
pnpm -r build
pnpm run release:verify
```

**Prerequisites:** Node.js 20+, pnpm 9+

---

## Project Structure

```
repo root               # github.com/kariemSeiam/fangai — pnpm workspace at repository root
├── packages/
│   ├── core/           ← FangServer, TaskManager, adapters registry
│   ├── client/         ← @fangai/client
│   ├── pi/             ← @fangai/pi
│   ├── adapters/       ← per-CLI adapters (aider, claude, codex, opencode, generic)
│   └── cli/            ← @fangai/cli (bin: fang, a2a-cli)
├── docs/
│   ├── FANG-SPEC.md
│   ├── ADAPTERS.md
│   ├── A2A-COMPLIANCE.md
│   ├── DEPLOYMENT.md
│   └── PUBLISHING.md
├── README.md
├── LICENSE
├── a2a.yaml            ← example multi-agent config
├── ARCHITECTURE.md
└── CHANGELOG.md
```

We use **pnpm workspaces**. Each package is independently publishable.

**Release:** [`docs/PUBLISHING.md`](docs/PUBLISHING.md) (npm) · [`../spec/16-RELEASE-CHECKLIST.md`](../spec/16-RELEASE-CHECKLIST.md) (checklist) · [`../spec/11-DISTRIBUTION-AND-PUBLISHING.md`](../spec/11-DISTRIBUTION-AND-PUBLISHING.md) (policy).

---

## How to Contribute

### Bug Reports

Open an issue with:
1. What you ran (exact command)
2. What happened
3. What you expected
4. CLI agent name and version
5. Node.js version (`node -v`)

### New Adapters

This is the highest-value contribution. See [`docs/ADAPTERS.md`](docs/ADAPTERS.md) for the full guide, but the short version:

1. Create `packages/adapters/<agent-name>/`
2. Extend `BaseAdapter` (three methods: `formatInput`, `parseOutput`, `canHandle`)
3. Write tests with real CLI output samples
4. Add to `AdapterRegistry.ts`
5. Update the supported agents table in README
6. Open a PR

**We merge adapter PRs fast.** New adapters directly grow the ecosystem.

### Documentation

- Fix typos, improve clarity — all welcome
- Add translations (Chinese, Japanese, Korean, Arabic, Portuguese are high priority)
- Add examples for new orchestrators (CrewAI, AutoGen, custom)
- Improve deployment guides (Kubernetes, Nomad, etc.)

### Examples

Working examples are incredibly valuable:
- Single-agent setups
- Multi-agent orchestration patterns
- Docker Compose stacks
- CI/CD integration
- Specific use cases (code review pipeline, research workflow, etc.)

---

## Development Workflow

### Building

```bash
pnpm -r build           # build all packages
pnpm -r build --filter @fangai/core   # build one package
pnpm -r build --filter @fangai/cli    # CLI only
```

### Testing

```bash
pnpm test               # build + all tests (root script)
pnpm test:only          # tests only (after build)
pnpm -r test --filter @fangai/pi   # one package
```

### Lint

Only **`@fangai/core`** defines ESLint today; CI runs **`pnpm run release:verify`** (build + test + core lint).

```bash
pnpm --filter @fangai/core lint
```

### Testing Locally

```bash
# Build first
pnpm -r build

# Run the CLI
node packages/cli/dist/index.js wrap "echo hello" --port 3001

# In another terminal
curl http://localhost:3001/.well-known/agent-card.json
node packages/cli/dist/index.js send --port 3001 "test message"
```

### Linking Globally (for testing)

```bash
cd packages/cli
pnpm link --global
fang wrap "echo test" --port 3001
```

---

## Code Style

- **TypeScript** strict mode everywhere
- **No `any`** — use proper types
- **Express** for HTTP (keep it boring, keep it reliable)
- **No WebSocket** — SSE only (simpler, firewall-friendly)
- **No database** — in-memory state, file-based config
- **Tests** required for adapters, encouraged for everything else

### File Naming

- PascalCase for classes: `FangServer.ts`, `TaskManager.ts`
- camelCase for utilities: `detectAdapter.ts`, `buildAgentCard.ts`
- Scoped names: first-party agents as `@fangai/<agent>` (e.g. `@fangai/pi`); shared fallbacks stay `@fangai/adapter-*` (e.g. `adapter-generic`)

### Commit Messages

We use conventional commits:

```
feat(adapter): add goose adapter
fix(core): handle ECONNREFUSED on SSE stream
docs(readme): add Docker Compose example
test(pi): add RPC event parsing tests
chore(deps): update express to 5.x
```

---

## PR Process

1. **Fork** the repo
2. **Branch** from `main`: `git checkout -b feat/my-adapter`
3. **Commit** with conventional commits
4. **Verify**: `pnpm run release:verify` passes (or equivalent build + test + `@fangai/core` lint)
5. **Open PR** against `main`
6. **Describe** what it does, why, and how you tested it

### PR Review Criteria

- Does it work? (we'll test it)
- Does it follow the adapter contract? (for adapters)
- Does it have tests? (required for adapters)
- Is the code clear? (no cleverness for cleverness' sake)

**We aim to review PRs within 48 hours.**

---

## Release Process

Maintainers: see **`docs/PUBLISHING.md`** and **`../spec/11-DISTRIBUTION-AND-PUBLISHING.md`**. Version bumps are aligned across **`@fangai/*`** packages; **`pnpm publish -r`** from the monorepo root when ready.

---

## Documentation map

| Doc | Audience |
| --- | --- |
| **[`README.md`](./README.md)** | Overview, install, CLI, roadmap |
| **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** | Design, data flow, security model |
| **[`docs/FANG-SPEC.md`](./docs/FANG-SPEC.md)** | Implementation draft — update with behavior changes |
| **[`docs/ADAPTERS.md`](./docs/ADAPTERS.md)** | Writing adapters |
| **[`CHANGELOG.md`](./CHANGELOG.md)** | Release history (`@fangai/*`) |
| **[`../spec/README.md`](../spec/README.md)** | Product spec and roadmap (parent folder) |

---

## Community Standards

- Be respectful. Every contributor started somewhere.
- English in issues and PRs (translations go in docs/)
- No AI-generated PRs that you haven't tested yourself
- If you're unsure, open an issue first — we'll figure it out together

---

## Good First Issues

Look for the `good first issue` label on GitHub. These are specifically chosen to be:

- Well-scoped (one thing to do)
- Well-documented (we explain what's needed)
- Low-risk (won't break existing functionality)
- High-value (they genuinely help the project)

---

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

*Thank you for building the bridge.*
