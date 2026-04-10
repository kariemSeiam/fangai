# Changelog

Notable changes to the Fang monorepo (`@fangai/*`). Workspace packages use aligned semver; bump versions together before `npm publish` (see `spec/11-DISTRIBUTION-AND-PUBLISHING.md`).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- _(Move user-facing changes here before tagging.)_

### Changed

- **`README.md`:** Footer nav links **[Changelog](CHANGELOG.md)**. **`CONTRIBUTING.md`:** **Documentation map** includes **`CHANGELOG.md`**. **`spec/16-RELEASE-CHECKLIST.md`:** Changelog item describes folding **`[Unreleased]`** vs adding a dated section.
- **`packages/core`:** **`hostDetect.test.ts`** uses a **15s** Vitest timeout — **`detectHostAgents()`** can exceed the default **5s** on slow or busy machines.
- **Repository layout:** **`@fangai/*`** pnpm workspace lives at the **repository root** (alongside **`spec/`**); clone/install docs use **`cd fangai`** after **`git clone`**; **`package.json`** **`repository`** / **`homepage`** / **`bugs`** and package README GitHub URLs updated accordingly.

## [0.1.0] — 2026-04-10

Baseline for the first **`@fangai/*`** npm publish (pre-release until tagged).

### Packaging

- Workspace packages ship only **`dist/`** (`files`); **`publishConfig.access: public`**; monorepo **`repository.directory`** paths; **`prepublishOnly`: `tsc`**. Run **`pnpm run release:verify`** (root) before publish.

### Added

- **Core (`@fangai/core`):** A2A v1 server via `@a2a-js/sdk` (JSON-RPC `/a2a`, REST, Agent Card); `FangAgentExecutor` with persistent and oneshot modes; optional **API key** on `/a2a` and REST (`FANG_API_KEY`, `FangConfig.apiKey`); **OpenCode** HTTP bridge (`openCodeServeUrl`, `@opencode-ai/sdk`); **`listen` host** (`FangConfig.host`).
- **CLI (`@fangai/cli`):** `fang wrap` / `fang serve`, `send`, `discover`, `detect`, `stop`; `--open-code-url` / password / directory; `--api-key`; **`--host`** / **`FANG_HOST`**; **`--port`**; smoke tests for **`--help`** / **`--version`**; **`vitest.config.ts`** (fork pool for stable isolated runs) (**`spec/12`**).
- **Adapters:** Pi, Claude, Codex, OpenCode, Aider, Generic (`@fangai/pi`, `@fangai/adapter-*`).
- **Client (`@fangai/client`):** `FangClient`, `discoverRunningAgents`, `callJsonRpc` with optional auth headers.
- **Quality:** Vitest across packages; ESLint flat config on `@fangai/core`; optional **`RUN_OPENCODE_INTEGRATION=1`** integration test for `opencode serve`; **`@fangai/client`** unit tests (mocked `fetch`); **`fangHttp.contract.test.ts`** — real **`FangServer`** + **`fetch`** for `/health`, agent card, JSON-RPC errors, **API key** gate (**`spec/12`**); **`FangServer.listeningPort()`** when using port **`0`**.
- **CI / docs:** `.github/workflows/ci.yml` — **`pnpm run release:verify`**; Dockerfiles **`pi`** / **`claude`**; **`docs/PUBLISHING.md`** and **`spec/12-TESTING-AND-CONTRACTS.md`** aligned with **`/a2a`** JSON-RPC and CI commands.

### Changed

- **`ARCHITECTURE.md`:** Removed obsolete **`/tasks/send`** sample; **Implementation reference** and **A2A surfaces** match **`@a2a-js/sdk`** + **`FangAgentExecutor`**; task lifecycle diagram uses **`message/send`**.
- **Docs / metadata:** **`README`** “Raw HTTP” uses **`POST /a2a`**; architecture tree lists real **`docs/`** files and packages (no bogus **`examples/`**); CLI reference lists **`detect`** (no separate **`card`** command). **`docs/ADAPTERS.md`** integration snippet; **`docs/A2A-COMPLIANCE.md`** mount path wording. **`buildAgentCard`** metadata uses **`fang_version`** only (drops duplicate **`a2a_cli_version`**).
- **`docs/FANG-SPEC.md`:** API key, **`host`**, OpenCode bridge, **`fang detect`**, Codex adapter; **`docs/PUBLISHING.md`** “See also” links.
- **`spec/README.md`:** links **`../docs/FANG-SPEC.md`**; playground note points at shipping monorepo at repo root.
- **Documentation pass (navigation + npm):** **`README`** hero/footer links **`ARCHITECTURE`**, **`FANG-SPEC`**, **`DEPLOYMENT`**; pre-release scope blurb; v0.1 roadmap includes **`send`** / **`detect`**; ASCII tree matches repo. **See also** / **Documentation map** tables across **`ARCHITECTURE`**, **`docs/*`** (`FANG-SPEC`, **`ADAPTERS`**, **`A2A-COMPLIANCE`**, **`DEPLOYMENT`**, **`PUBLISHING`**), **`CONTRIBUTING`**, **`spec/README`**, **`spec/11`**; **`docs/PUBLISHING`** package table + README links + **`npm pack`** / **`files`** note; **`docs/DEPLOYMENT`** pre-release from-source note; **`A2A-COMPLIANCE`** JSON-RPC **`curl`** uses **`POST /a2a`**. **Package READMEs:** **`@fangai/cli`**, **`@fangai/core`**, **`@fangai/client`**, **`@fangai/pi`** (npm + GitHub links). **Root `package.json`:** **`repository`**, **`homepage`**, **`bugs`**; remove unused **`@fangai/cli`** devDependency; keywords **`codex`**. **`@fangai/cli`** / **`@fangai/core`** **`package.json`** keywords for discovery.

### Spec alignment

- Agent Card and task lifecycle follow **A2A v1** patterns exposed by `@a2a-js/sdk`; track their releases when upgrading the SDK.
