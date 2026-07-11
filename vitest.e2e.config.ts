import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/e2e/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 180_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
