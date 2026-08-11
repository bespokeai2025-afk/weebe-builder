/**
 * Confirm RETELL_API_KEY_DNR can access agent_b2afcd65c127f79126ea57deb2.
 * Custom tool signatures are signed with the owning Retell account's API key.
 *
 *   node --env-file=.env scripts/verify-dnr-retell-key.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));
const RETELL_AGENT_ID = "agent_b2afcd65c127f79126ea57deb2";

function loadDotEnv() {
  try {
    for (const line of readFileSync(resolve(__dir, "../.env"), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

loadDotEnv();

const key = (process.env.RETELL_API_KEY_DNR || process.env.RETELL_API_KEY)?.trim();
if (!key?.startsWith("key_")) {
  console.error("❌ RETELL_API_KEY_DNR missing or invalid in .env");
  console.error("  Add: RETELL_API_KEY_DNR=key_…  (from the DNR Retell account)");
  process.exit(1);
}

const res = await fetch(`https://api.retellai.com/get-agent/${RETELL_AGENT_ID}`, {
  headers: { Authorization: `Bearer ${key}` },
});

if (res.ok) {
  const agent = await res.json();
  console.log("✅ Retell key matches the DNR agent account");
  console.log("  agent:", agent.agent_name ?? RETELL_AGENT_ID);
  console.log("  env var:", process.env.RETELL_API_KEY_DNR ? "RETELL_API_KEY_DNR" : "RETELL_API_KEY");
  process.exit(0);
}

console.error("❌ Retell key cannot access the DNR agent (HTTP", res.status + ")");
console.error("  Copy the API key from the Retell account that owns agent_b2afcd65…");
console.error("  into .env as RETELL_API_KEY_DNR=key_…");
process.exit(1);
