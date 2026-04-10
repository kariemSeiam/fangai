# @fangai/client

Small **A2A client** for scripts and orchestrators calling Fang (or any `@a2a-js/sdk` JSON-RPC server).

```typescript
import { FangClient, discoverRunningAgents } from "@fangai/client";

const agents = await discoverRunningAgents();
const client = new FangClient("http://localhost:3001");
const card = await client.getAgentCard();
const result = await client.sendMessage("Explain this repo.");
```

API surface: `src/index.ts` (`callJsonRpc`, `streamMessage`, re-exported `AgentCard` type).

## Docs

- **[Monorepo `README.md`](https://github.com/kariemSeiam/fangai/blob/main/README.md)** — orchestration context, `fang send`, JSON-RPC
- **[`docs/PUBLISHING.md`](https://github.com/kariemSeiam/fangai/blob/main/docs/PUBLISHING.md)** — installing `@fangai/client` from npm with the rest of the scope
- **[`docs/FANG-SPEC.md`](https://github.com/kariemSeiam/fangai/blob/main/docs/FANG-SPEC.md)** — HTTP surfaces and auth headers
