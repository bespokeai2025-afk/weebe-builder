import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Bun/dotenv expand `$var` inside .env values (e.g. Be$poke@741 → Be@741).
 * Read WEBESPOKE admin creds from the .env file with quotes stripped instead.
 */
function parseDotenvFile(filePath: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      out[key] = val;
    }
  } catch {
    /* no .env in this environment */
  }
  return out;
}

let fileCache: Record<string, string> | null = null;

function getEnvFileVars(): Record<string, string> {
  if (!fileCache) {
    fileCache = parseDotenvFile(join(process.cwd(), ".env"));
  }
  return fileCache;
}

export function getWebespokeAdminCreds(): { email: string; password: string } | null {
  const file = getEnvFileVars();
  const email = (file.WEBESPOKE_ADMIN_EMAIL ?? process.env.WEBESPOKE_ADMIN_EMAIL ?? "").trim();
  const password = file.WEBESPOKE_ADMIN_PASSWORD ?? process.env.WEBESPOKE_ADMIN_PASSWORD ?? "";
  if (!email || !password) return null;
  return { email, password };
}

/** Read server env from .env file first — Vite dev often omits non-VITE_* vars from process.env. */
export function getWebespokeEnvVar(name: string): string | undefined {
  const file = getEnvFileVars();
  const fromFile = file[name]?.trim();
  if (fromFile) return fromFile;
  const fromProcess = process.env[name]?.trim();
  return fromProcess || undefined;
}

const DEFAULT_WEBESPOKE_API_BASE = "https://uat-api.webespokeai.com";

export function getWebespokeApiBaseUrlFromEnv(): string {
  const raw = getWebespokeEnvVar("WEBESPOKE_API_BASE_URL");
  return (raw || DEFAULT_WEBESPOKE_API_BASE).replace(/\/$/, "");
}
