import { defineConfig } from "vitest/config";

export default defineConfig({
  // test/live.test.ts is skipped unless KRUN_LIVE_TESTS=1 (npm run test:live).
  test: { include: ["test/**/*.test.ts"] },
});
