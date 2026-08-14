// Runs before every other vite.config import (ESM imports execute in order, and
// this file is the FIRST import in vite.config.ts). See vite.config.ts for why:
// the VITE_SUPABASE_URL / SUPABASE_URL secrets have repeatedly been saved with the
// service-role key pasted in place of the URL; normalize before any plugin module
// captures process.env at import time.
export const CANONICAL_SUPABASE_URL = "https://ugrsdmmztnfgeajhwhzy.supabase.co";
const isValidSupabaseUrl = (v: unknown): boolean =>
  typeof v === "string" && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(v);
for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) {
  if (!isValidSupabaseUrl(process.env[key])) process.env[key] = CANONICAL_SUPABASE_URL;
}
