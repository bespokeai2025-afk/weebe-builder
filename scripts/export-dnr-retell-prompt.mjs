/**
 * Export Dr Nyla Retell deploy bundle (prompt + tool URLs).
 *
 *   PUBLIC_BASE_URL=https://your-domain.com bun scripts/export-dnr-retell-prompt.mjs
 */
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getDrNylaRetellPrompt } from "../src/lib/dnr/dr-nyla-receptionist.prompt.ts";

const __dir = dirname(fileURLToPath(import.meta.url));
const publicBase =
  process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  process.env.VITE_PUBLIC_BASE_URL?.replace(/\/+$/, "") ||
  "https://YOUR-WEBEE-DOMAIN.com";

const bundle = getDrNylaRetellPrompt(publicBase);
const outDir = resolve(__dir, "output");
mkdirSync(outDir, { recursive: true });

const outPath = resolve(outDir, "dnr-dr-nyla-retell-agent.json");
writeFileSync(outPath, JSON.stringify(bundle, null, 2));

console.log("✅ Wrote", outPath);
console.log("\nRetell agent: agent_b2afcd65c127f79126ea57deb2");
console.log("Begin message:", bundle.begin_message);
console.log("\nNext: bun scripts/setup-dnr-voice-system.mjs");
