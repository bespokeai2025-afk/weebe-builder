// Runs before every other vite.config import (ESM imports execute in order, and
// this file is the FIRST import in vite.config.ts). See vite.config.ts for why:
// the VITE_SUPABASE_URL / SUPABASE_URL secrets have repeatedly been saved with the
// service-role key pasted in place of the URL; normalize before any plugin module
// captures process.env at import time.
//
// The project URL comes from the configuration (see src/lib/supabase-url-guard.ts): the .env files
// are read here because Vite has not loaded them yet when vite.config is imported, and real
// environment variables still win over .env, as they do in Vite.
import { readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { ensureValidSupabaseUrlEnv } from "./src/lib/supabase-url-guard";

function configTomlProjectRef(): string | undefined {
  try {
    const toml = readFileSync("supabase/config.toml", "utf8");
    return toml.match(/^\s*project_id\s*=\s*"([a-z0-9-]+)"/m)?.[1];
  } catch {
    return undefined;
  }
}

const mode = process.argv.includes("build") ? "production" : "development";
const merged: Record<string, string | undefined> = { ...loadEnv(mode, process.cwd(), ""), ...process.env };
const url = ensureValidSupabaseUrlEnv(merged, configTomlProjectRef());
if (url) {
  for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL"]) process.env[key] = merged[key];
}

/** The project URL the client bundle is built with (undefined when nothing configures one). */
export const SUPABASE_PROJECT_URL = url;
