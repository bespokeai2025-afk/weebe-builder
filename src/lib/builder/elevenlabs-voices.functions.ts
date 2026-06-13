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

export interface CloneVoiceResult {
  voice_id: string;
  name: string;
}

/**
 * Upload audio sample(s) to ElevenLabs Instant Voice Cloning.
 * Accepts a single file as base64 + metadata, returns the new voice_id.
 * Invalidates the listElevenLabsVoices cache so it appears immediately.
 */
export const cloneElevenLabsVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (data: unknown) =>
      data as { name: string; fileName: string; mimeType: string; base64: string },
  )
  .handler(async ({ data }): Promise<CloneVoiceResult> => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not configured on this server.");

    const { name, fileName, mimeType, base64 } = data;
    const buffer = Buffer.from(base64, "base64");
    const blob = new Blob([buffer], { type: mimeType || "audio/mpeg" });

    const form = new FormData();
    form.append("name", name?.trim() || "Uploaded Voice");
    form.append("files", blob, fileName || "sample.mp3");

    const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form as unknown as BodyInit,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => String(res.status));
      throw new Error(`ElevenLabs voice clone failed (${res.status}): ${body}`);
    }

    const result = (await res.json()) as { voice_id: string };

    // Bust the voices cache so the cloned voice appears in the next list call.
    _cache = null;
    _cacheAt = 0;

    return { voice_id: result.voice_id, name: name?.trim() || "Uploaded Voice" };
  });

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
