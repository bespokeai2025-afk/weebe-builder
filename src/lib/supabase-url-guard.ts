// Supabase URL guard — bundled into dist/server/server.js so it covers EVERY production start path
// (srvx --entry dist/server/server.js on AWS, scripts/prod-entry.mjs, Vercel functions); env-guard.ts
// (repo root) runs the same resolution for vite dev/build.
//
// Why: the VITE_SUPABASE_URL / SUPABASE_URL secrets have repeatedly been saved with the service-role
// key pasted in place of the URL. Any invalid value is replaced with the project URL worked out from
// the rest of the configuration — never a URL written into the code, so moving to another Supabase
// project only needs the env (and supabase/config.toml) changed.

const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/;
const URL_KEYS = ["VITE_SUPABASE_URL", "SUPABASE_URL"] as const;
const JWT_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
] as const;

type Env = Record<string, string | undefined>;

export function isValidSupabaseUrl(value: unknown): value is string {
  return typeof value === "string" && SUPABASE_URL_RE.test(value.trim());
}

export function supabaseUrlForRef(ref: string): string {
  return `https://${ref}.supabase.co`;
}

/** The project ref inside a legacy Supabase JWT key ("eyJ…"), or undefined for any other value. */
export function refFromSupabaseJwt(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  const parts = key.trim().split(".");
  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) return undefined;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="))) as {
      ref?: unknown;
    };
    return typeof payload.ref === "string" && /^[a-z0-9-]+$/.test(payload.ref)
      ? payload.ref
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The Supabase project URL from the configuration: a valid URL variable first, then the project ref
 * inside a legacy JWT key, then `fallbackRef` (supabase/config.toml's project_id, where readable).
 */
export function resolveSupabaseUrl(env: Env, fallbackRef?: string): string | undefined {
  const fromUrl = URL_KEYS.map((k) => env[k]).find(isValidSupabaseUrl);
  if (fromUrl) return fromUrl.trim().replace(/\/$/, "");
  const ref = JWT_KEYS.map((k) => refFromSupabaseJwt(env[k])).find(Boolean) ?? fallbackRef;
  return ref ? supabaseUrlForRef(ref) : undefined;
}

// NOTE: package.json has "sideEffects": false, so a bare side-effect import of
// this module gets tree-shaken. Callers MUST invoke this function explicitly.
/** Replace a missing or invalid VITE_SUPABASE_URL / SUPABASE_URL with the resolved project URL. */
export function ensureValidSupabaseUrlEnv(
  env: Env = process.env,
  fallbackRef?: string,
): string | undefined {
  const url = resolveSupabaseUrl(env, fallbackRef);
  if (!url) {
    console.warn(
      "[supabase] No valid SUPABASE_URL / VITE_SUPABASE_URL and no project ref to derive one from.",
    );
    return undefined;
  }
  for (const key of URL_KEYS) {
    if (!isValidSupabaseUrl(env[key])) env[key] = url;
  }
  return url;
}
