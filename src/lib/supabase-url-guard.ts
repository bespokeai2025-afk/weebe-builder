// Server-runtime Supabase URL guard — bundled into dist/server/server.js so it
// covers EVERY production start path (srvx --entry dist/server/server.js on AWS,
// scripts/prod-entry.mjs, Vercel functions), unlike the vite.config/prod-entry
// guards which only run on specific paths.
//
// Why: the VITE_SUPABASE_URL / SUPABASE_URL secrets have repeatedly been saved
// with the service-role key pasted in place of the URL. The project URL is
// public and stable, so normalize any invalid value to the canonical URL.
// Keep CANONICAL_SUPABASE_URL in sync with env-guard.ts (repo root).
export const CANONICAL_SUPABASE_URL = "https://ugrsdmmztnfgeajhwhzy.supabase.co";

const isValidSupabaseUrl = (v: unknown): boolean =>
  typeof v === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v);

// NOTE: package.json has "sideEffects": false, so a bare side-effect import of
// this module gets tree-shaken. Callers MUST invoke this function explicitly.
export function ensureValidSupabaseUrlEnv(): void {
  for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) {
    if (!isValidSupabaseUrl(process.env[key])) {
      process.env[key] = CANONICAL_SUPABASE_URL;
    }
  }
}
