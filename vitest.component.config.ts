import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // Fast suite — no live database. Live-database tests: npm run test:e2e.
    include: ["tests/component/**/*.test.{ts,tsx}", "src/lib/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    globals: false,
    testTimeout: 30_000,
    pool: "threads",
    fileParallelism: false,
  },
});
