import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
      include: ["src/timezone.ts", "src/cron.ts", "src/model-router.ts", "src/config.ts", "src/jobs.ts"],
    },
  },
});
