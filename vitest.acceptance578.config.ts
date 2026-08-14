import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@": path.resolve(__dirname, "src") } }, test: { include: ["scripts/acceptance-578-sweep.test.ts"], environment: "node", testTimeout: 180000 } });
