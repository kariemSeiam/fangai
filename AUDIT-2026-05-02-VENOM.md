# FangAI Deep Audit — VENOM 🐙

**Auditor:** VENOM (GLM-5.1 via Z.AI)
**Date:** May 2, 2026
**Scope:** Full codebase audit (legacy `src/` + monorepo `packages/`) — static + live runtime testing
**Method:** Source read + TypeScript compilation + test suite run + live server spin-up + endpoint probing

---

## EXECUTIVE SUMMARY

The April 29 audit was 70% right in its *hypotheses* but wrong about the codebase it was reading. FangAI has **two codebases** — the legacy flat `src/` and the new monorepo `packages/`. The old audit read `src/` (which is partially stale). The real production code lives in `packages/`. Several "CRITICAL" bugs the old audit found don't exist in the new code. But the new code has its own bugs the old audit never touched.

**Score: 38 findings total. 6 Critical, 9 High, 12 Medium, 11 Low.**

---

## ❌ OLD AUDIT — WHAT IT GOT WRONG

| Old Claim | Reality |
|---|---|
| `AiderAdapter` hardcodes `'--message', 'CMD'` | Still true in legacy `src/adapters.ts` line 349. **BUT** the packages code is different — `packages/adapters/aider/src/index.ts` likely has its own implementation. Legacy code is still shipped and used by `fang wrap`. |
| `GeminiAdapter` never emits `completed` | True in legacy `src/adapters.ts`. Gemini `parseLine` returns only `text-delta` events. **Still unfixed.** |
| `executePersistent` returns before completion | **Fixed** in packages. `FangAgentExecutor.ts` wraps in `Promise<void>` with `finishExecute` callback (line 262-305). Legacy `src/server.ts` had the bug. |
| `this.persistent` init race | **Fixed** in packages. `ensurePersistentShell()` is now a guard method, `activePersistent` is a single slot, and concurrent calls get immediate "busy" rejection (line 247-258). |
| Concurrent `write()` interleaves Pi session | **Fixed** in packages. `activePersistent` is a mutex — second task gets rejected immediately. |
| `JSON.parse(tc.arguments)` crashes server | **Fixed** in packages. Pi adapter `parseOutput` wraps JSON.parse in try-catch. |
| Auth blocks agent card discovery | **CONFIRMED STILL BROKEN** in legacy `src/`. Packages code puts `cardMw` BEFORE the `gate` middleware — but legacy `src/server.ts` applies auth to ALL routes. Live test confirmed: with `--api-key`, agent card requires auth. **A2A spec violation.** |
| Agent card URL hardcoded to localhost | **Partially fixed** in packages — reads `FANG_PUBLIC_URL` env var. Legacy `src/` still hardcodes. |

---

## 🔴 CRITICAL (6)

### C1. Legacy `src/` AiderAdapter sends literal "CMD" as message
**File:** `src/adapters.ts:348-350`
```typescript
buildArgs(_task: AgentTask, _config: FangConfig): string[] {
    return ['--message', 'CMD', '--yes', '--no-auto-commits', '--no-pretty'];
}
```
Every Aider task sends literal string "CMD" instead of the user's message. `formatInput` writes `task.message + '\n/exit\n'` to stdin but `--message CMD` already consumed stdin. The `--message` flag takes precedence in Aider. **All Aider tasks are broken.**

**Fix:** Remove `'--message', 'CMD'` from `buildArgs`. Let `formatInput` handle the message via stdin.

### C2. Legacy `src/` GeminiAdapter never emits completion
**File:** `src/adapters.ts:464-479`
`parseLine` only returns `text-delta` and `log` events. No `completed` detection. Every Gemini task hangs until timeout.

**Fix:** Add Gemini's completion event detection in `parseLine`.

### C3. Agent card blocked when API key is set (A2A spec violation)
**File:** Legacy `src/server.ts` — auth middleware applied globally.
**Live confirmed:** With `--api-key`, `/.well-known/agent-card.json` returns 401.
A2A spec requires agent cards be publicly discoverable. This breaks multi-agent orchestration.

**Packages code** has this correct — `cardMw` is mounted before `gate`. But the legacy code (used by `fang wrap`) is still broken.

### C4. `health` endpoint blocked by API key
**File:** Legacy `src/server.ts`
**Live confirmed:** `/health` returns 401 when `--api-key` is set. Health checks are infrastructure — they should always be accessible.

### C5. `CursorAdapter` not exported from `src/index.ts`
**File:** `src/index.ts:7`
```typescript
export { PiAdapter, ClaudeAdapter, AiderAdapter, CodexAdapter, GeminiAdapter, OpenCodeAdapter, GenericAdapter, detectAdapter, ALL_ADAPTERS } from './adapters.ts';
```
`CursorAdapter` is missing from the export list. External consumers cannot access it. It's in `ALL_ADAPTERS` but not the public API.

### C6. TypeScript compilation fails completely
**File:** `tsconfig.json` / all `.ts` files
```
error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
```
Plus: `AgentCard.skills` type mismatch — adapter skills missing `description` field required by `@a2a-js/sdk`.
**No type checking is possible.** Runtime works via `--experimental-strip-types` but there's zero compile-time safety.

---

## 🟠 HIGH (9)

### H1. Two codebases, zero documentation about which is canonical
Legacy `src/` and monorepo `packages/` coexist. Both have their own tests, their own logic. `fang wrap` uses legacy. The packages code is more evolved. **Nobody knows which one to fix.** This is the biggest architecture debt.

### H2. `packages/client` tests failing (2/3)
```
FAIL callJsonRpc > POSTs JSON-RPC to {base}/a2a and returns result
Expected: "http://127.0.0.1:3001/a2a"
Received:  "http://127.0.0.1:3001/a2a/jsonrpc"
```
Client was updated to use `/a2a/jsonrpc` but tests still expect `/a2a`. Tests are stale.

### H3. CORS `Access-Control-Allow-Origin: *` with no config
**Live confirmed.** The `--cors` flag enables `*` origin. No restriction possible. Fine for local dev, dangerous if exposed. No option to specify allowed origins.

### H4. `send`/`sendStream` in client have no timeout
**File:** `src/client.ts:39-53`
`health()` uses `AbortSignal.timeout(3000)` but `sendStream` has no timeout. A hung server = infinite block on the client.

### H5. `splitCli` doesn't handle escaped quotes or complex args
**File:** `packages/core/src/splitCli.ts` (same logic in `src/core.ts`)
Hand-rolled parser. `fang wrap "aider --message \"hello world\""` would break. Doesn't handle `\"` or `\\` escapes.

### H6. Process leak on `SIGTERM` in legacy `src/server.ts`
**File:** `src/server.ts:225`
Shutdown handler doesn't `await this.pm.killAll()`. Processes survive server exit.

### H7. `executeOneshot` ignores `complete` events from adapter
**File:** `packages/core/src/FangAgentExecutor.ts:547-548`
```typescript
case "complete":
    break; // ← does nothing
```
When an adapter emits `complete`, the code *ignores it* and waits for process exit. This means even when a CLI signals completion, FangAI waits for the process to die. Adds latency and can miss early completion signals.

### H8. `--max-turns 10` hardcoded in ClaudeAdapter
**File:** `src/adapters.ts:227`
Should come from config. No way to override without changing source.

### H9. `bin` in package.json points to TypeScript source
**File:** `package.json:6`
```json
"bin": { "fang": "src/cli.ts" }
```
Points to `.ts` file, not compiled JS. Requires `--experimental-strip-types` on every invocation. Unreliable on older Node versions.

---

## 🟡 MEDIUM (12)

### M1. `@types/which` in devDependencies — `which` never imported in legacy
**File:** `package.json:45`
Dead dependency.

### M2. `devDependencies` reference non-existent `workspace:*` packages
**File:** `package.json:37-42`
`@fangai/adapter-aider`, etc. These exist in the monorepo but `package.json` at root still references them. Confusing for contributors.

### M3. `"fang"` script points to non-existent path
**File:** `package.json:26`
```json
"fang": "node ./packages/cli/dist/index.js"
```
This file doesn't exist — packages aren't built.

### M4. `GenericAdapter.detect()` splits by space — same fragility as `splitCli`
**File:** `src/adapters.ts:566`

### M5. Gemini `formatInput` uses hardcoded `id: 1` for JSON-RPC
**File:** `src/adapters.ts:457`
Session correlation impossible. Concurrent requests corrupt each other.

### M6. Gemini `sessionId` is dead state
**File:** `src/adapters.ts:462`
Set but never read. Singleton adapter means concurrent requests corrupt the field.

### M7. OpenCode `buildArgs` appends message as positional arg
**File:** `src/adapters.ts:509`
Multi-word messages may not work depending on CLI design. Needs `--` terminator.

### M8. OpenCode `parseLine` inconsistency — computed `text` variable ignored
**File:** `src/adapters.ts:521-524`
```typescript
const text = obj.text || obj.content || obj.part?.text || '' // computed
// ...
case 'content': return [{ type: 'text-delta', text: obj.text || '' }] // ignores `text`
```

### M9. Agent card leaks `metadata.backend` (CLI command)
**File:** Live test response shows full CLI in metadata:
```json
"metadata": {"backend": "claude -p --output-format stream-json --verbose", ...}
```
If the CLI includes paths or credentials, they're leaked.

### M10. No request body size limit on subprocess forwarding
**File:** `src/server.ts` passes entire request body to subprocess stdin. 20MB limit on Express body but forwarded entirely.

### M11. `InMemoryTaskStore` = zero durability, no eviction
Server restart loses all task state. No eviction policy — grows unbounded.

### M12. `packages/core/src/hostDetect.ts` imports `which` npm package
But legacy `src/adapters.ts` uses custom `whichBinary` function to avoid the ESM bug. Inconsistency — one path has the bug, the other works around it.

---

## 🟢 LOW (11)

### L1. `publishMessage` always publishes `failed` status — misleading name
### L2. Heavy `any` usage in server.ts and client.ts — A2A SDK ships types
### L3. SSE multi-line `data:` fields silently truncated in client parser
### L4. `message_end` in Pi adapter contains full accumulated text but is dropped
### L5. Non-JSON Claude stdout gets extra `\n` appended
### L6. `taskQueue` conflates "active" and "pending" — confusing semantics
### L7. Pi `extension_ui_request` double-handled — adapter drops, PersistentProcess auto-responds
### L8. Codex adapter has no handling for `item.error` event type
### L9. Generic adapter never emits `completed` — always relies on process exit
### L10. `CursorAdapter` uses binary name `agent` — extremely generic, high false-positive
### L11. `package.json` version still `0.1.0` despite multiple published releases

---

## ARCHITECTURE DIAGNOSIS

### Two-Codebase Cancer
This is the #1 problem. Legacy `src/` and monorepo `packages/` serve the same purpose but diverge in implementation quality. Bug fixes go to one but not the other. Tests cover different things. **Pick one. Kill the other.**

**Recommendation:** Legacy `src/` is the one `fang wrap` actually uses. Either:
1. Delete `packages/` and keep `src/` as canonical (simpler, `fang wrap` works)
2. Delete `src/`, make `packages/cli` the binary, ensure `packages/` adapters are complete

### Missing Tests That Matter
- `BridgeExecutor.execute` (oneshot) — **core execution untested**
- `BridgeExecutor.execute` (persistent) — **Pi execution untested**  
- `cancelTask` — cancel behavior untested
- Process lifecycle (spawn/kill/killAll) — untested
- PersistentProcess concurrent tasks — untested
- `FangClient.sendStream` timeout — untested
- Auth middleware enforcement — untested (packages tests are better here)

---

## OLD AUDIT vs REALITY — VERDICT TABLE

| # | Old Finding | Status | Notes |
|---|---|---|---|
| 1 | Aider `'--message', 'CMD'` | ✅ CONFIRMED | Still broken in legacy |
| 2 | Gemini never emits completed | ✅ CONFIRMED | Still broken |
| 3 | executePersistent returns early | ❌ FIXED (packages) | Still broken in legacy |
| 4 | Persistent init race | ❌ FIXED (packages) | Legacy still vulnerable |
| 5 | Concurrent write() interleaves | ❌ FIXED (packages) | Legacy still vulnerable |
| 6 | JSON.parse crashes on Pi args | ❌ FIXED (packages) | Legacy still vulnerable |
| 7 | Processes leak on shutdown | ⚠️ PARTIAL | Packages fixes it, legacy doesn't |
| 8 | Auth blocks agent card | ✅ CONFIRMED | Legacy broken, packages fixed |
| 9 | No timeout on send/sendStream | ✅ CONFIRMED | Both codebases affected |
| 10 | CursorAdapter not exported | ✅ CONFIRMED | Still missing from index.ts |

---

## TOP 10 ACTION ITEMS (ranked by impact)

| Rank | Finding | Severity | Action |
|---|---|---|---|
| 1 | Two codebases | HIGH | Pick one canonical. Delete the other. This is blocking every fix. |
| 2 | Aider `'CMD'` placeholder | CRITICAL | Remove from `buildArgs`. Today. |
| 3 | Gemini no completion | CRITICAL | Add completion event detection. |
| 4 | Auth blocks agent card + health | CRITICAL | Mount card/health before auth gate. A2A spec violation. |
| 5 | TS compilation broken | CRITICAL | Fix imports, fix `AgentCard.skills` type mismatch. |
| 6 | CursorAdapter not exported | CRITICAL | Add to `index.ts` exports. |
| 7 | Packages client tests failing | HIGH | Update test expectations to match `/a2a/jsonrpc` endpoint. |
| 8 | `complete` event ignored in oneshot | HIGH | Handle `complete` in `applyUpdate` — resolve immediately instead of waiting for exit. |
| 9 | No client timeout | MEDIUM | Add `AbortSignal.timeout` to `sendStream`. |
| 10 | CORS wildcard | MEDIUM | Add configurable origins option. |

---

*End of VENOM audit. This is a living document — run the fixes, then re-audit.*
