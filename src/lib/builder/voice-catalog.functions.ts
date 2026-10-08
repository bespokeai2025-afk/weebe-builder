/**
 * Live voice catalogues for the builder's voice pickers.
 *
 * The Retell picker offered a fixed list of 14 voices written into the component, and the Cartesia
 * field was a bare text box for a voice UUID. Both providers publish their catalogue, so the
 * builder now reads it — new voices appear without a code change. The components keep their old
 * lists only as a fallback when the catalogue cannot be reached.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { lookupWorkspaceVoiceApiKey } from "@/lib/voice/stt/workspace-key";
import { resolveRetellKey } from "./knowledge-base.functions";

export interface CatalogVoice {
  id: string;
  name: string;
  /** Upstream TTS vendor (Retell hosts several). */
  provider?: string;
  gender?: string;
  accent?: string;
  language?: string;
  previewUrl?: string;
}

const CATALOG_TIMEOUT_MS = 8_000;

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const listRetellVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CatalogVoice[]> => {
    const key = await resolveRetellKey((context as { workspaceId?: string }).workspaceId);
    const data = await getJson("https://api.retellai.com/list-voices", {
      Authorization: `Bearer ${key}`,
    });
    const rows = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
    return rows
      .map((v) => ({
        id: str(v.voice_id),
        name: str(v.voice_name) || str(v.voice_id),
        provider: str(v.provider),
        gender: str(v.gender),
        accent: str(v.accent),
        previewUrl: str(v.preview_audio_url),
      }))
      .filter((v) => v.id);
  });

const CARTESIA_VERSION = "2025-04-16";

export const listCartesiaVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { query?: string }) => d)
  .handler(async ({ context, data }): Promise<CatalogVoice[]> => {
    const workspaceId = (context as { workspaceId?: string }).workspaceId;
    const key =
      (await lookupWorkspaceVoiceApiKey(supabaseAdmin as never, workspaceId, "cartesia")) ||
      String(process.env.CARTESIA_API_KEY ?? "").trim();
    if (!key) throw new Error("Add a Cartesia API key under Settings → Integrations → Voice Engines.");
    const params = new URLSearchParams({ limit: "100" });
    const q = String(data.query ?? "").trim();
    if (q) params.set("q", q);
    const body = (await getJson(`https://api.cartesia.ai/voices?${params}`, {
      "X-API-Key": key,
      "Cartesia-Version": CARTESIA_VERSION,
    })) as { data?: Array<Record<string, unknown>> };
    return (body.data ?? [])
      .map((v) => ({
        id: str(v.id),
        name: str(v.name) || str(v.id),
        gender: str(v.gender),
        language: str(v.language),
        accent: str(v.country),
      }))
      .filter((v) => v.id);
  });
