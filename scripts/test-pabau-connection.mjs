/**
 * Verify PABAU_API_KEY against Pabau oauth API (local dev).
 *
 *   node --env-file=.env scripts/test-pabau-connection.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

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

const key = process.env.PABAU_API_KEY?.trim();
if (!key) {
  console.error("Missing PABAU_API_KEY in .env");
  process.exit(1);
}

const base = (process.env.PABAU_API_BASE ?? `https://api.oauth.pabau.com/${encodeURIComponent(key)}`).replace(/\/+$/, "");
const headers = { Accept: "application/json" };

for (const path of ["/appointments", "/leads"]) {
  const res = await fetch(`${base}${path}`, { headers });
  const text = (await res.text()).slice(0, 400);
  console.log(`${res.status} GET ${base}${path}`);
  console.log(text);
  console.log("");
}
