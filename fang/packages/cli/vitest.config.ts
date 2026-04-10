import { defineConfig } from "vitest/config";

/** Fork pool avoids tinypool teardown glitches when running this package's tests in isolation (`pnpm --filter @fangai/cli test`). */
export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
