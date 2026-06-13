/**
 * ElevenLabs voice catalog — server functions for the Builder UI.
 *
 * listElevenLabsVoices returns all voices accessible to the configured
 * ELEVENLABS_API_KEY, with a 10-minute in-process cache so the Builder
 * panel doesn't hit the API on every panel open.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface ElVoice {
  voice_id: string;
  name: string;
  category: string;
  preview_url: string | null;
  labels: Record<string, string>;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
let _cache: ElVoice[] | null = null;
let _cacheAt = 0;

export const listElevenLabsVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ElVoice[]> => {
    const now = Date.now();
    if (_cache && now - _cacheAt < CACHE_TTL_MS) return _cache;

    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not configured on this server.");
    }

    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => res.status.toString());
      throw new Error(`ElevenLabs voices API error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as {
      voices: Array<{
        voice_id: string;
        name: string;
        category?: string;
        preview_url?: string | null;
        labels?: Record<string, string>;
      }>;
    };

    _cache = (data.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
      category: v.category ?? "general",
      preview_url: v.preview_url ?? null,
      labels: v.labels ?? {},
    }));
    _cacheAt = now;
    return _cache;
  });
