/** Builder — voices: custom voice clones, ElevenLabs search, previews, community voices. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { RETELL_BASE } from "@/lib/builder/retell-telephony.server";

/**
 * Clone a custom voice in Retell from an uploaded audio sample.
 * Client sends base64-encoded audio + filename/mime; we forward as multipart
 * to Retell's POST /clone-voice endpoint and return the new voice_id.
 */
export const cloneCustomVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      voiceName: string;
      voiceProvider?: "elevenlabs" | "cartesia" | "minimax" | "fish_audio" | "platform";
      fileBase64: string;
      fileName: string;
      mimeType?: string;
    }) => input,
  )
  .handler(async ({ data, context }) => {
    const name = data.voiceName.trim();
    if (!name) throw new Error("Voice name is required");
    if (!data.fileBase64) throw new Error("Audio file is required");

    const workspaceId = (context as any).workspaceId ?? null;
    const bytes = Buffer.from(data.fileBase64, "base64");
    const blob = new Blob([bytes], { type: data.mimeType || "audio/mpeg" });

    // Prefer cloning directly via ElevenLabs using the workspace key — result lives
    // in their ElevenLabs account and is returned as 11labs-{id}.
    let elKey: string | null = process.env.ELEVENLABS_API_KEY ?? null;
    if (workspaceId) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("elevenlabs_api_key" as never)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        const wsKey = (ws as any)?.elevenlabs_api_key ?? null;
        if (wsKey) elKey = wsKey;
      } catch { /* column may not exist yet */ }
    }

    if (elKey) {
      // Clone directly via ElevenLabs API
      const elForm = new FormData();
      elForm.append("name", name);
      elForm.append("files", blob, data.fileName || "sample.mp3");

      const elRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
        method: "POST",
        headers: { "xi-api-key": elKey },
        body: elForm,
      });
      const elText = await elRes.text();
      let elParsed: Record<string, unknown> = {};
      try { elParsed = elText ? JSON.parse(elText) : {}; } catch { /* raw */ }
      if (!elRes.ok) {
        const msg = (elParsed.detail as string | undefined) || elText || elRes.statusText;
        throw new Error(`ElevenLabs clone failed (${elRes.status}): ${msg}`);
      }
      const elVoiceId = String(elParsed.voice_id ?? "");
      if (!elVoiceId) throw new Error("ElevenLabs did not return a voice ID");
      return {
        voiceId: `11labs-${elVoiceId}`,
        voiceName: name,
        previewAudioUrl: null,
      };
    }

    // Fallback: clone via Retell's /clone-voice endpoint (uses platform ElevenLabs account)
    const retellKey = process.env.RETELL_API_KEY;
    if (!retellKey) throw new Error("No ElevenLabs key configured — add one in Settings → Integrations, or contact your admin");

    const form = new FormData();
    form.append("voice_name", name);
    form.append("voice_provider", data.voiceProvider ?? "elevenlabs");
    form.append("files", blob, data.fileName || "sample.mp3");

    const res = await fetch(`${RETELL_BASE}/clone-voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${retellKey}` },
      body: form,
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* raw */ }
    if (!res.ok) {
      const message = (parsed.message as string | undefined) || text || res.statusText;
      throw new Error(`Voice clone failed (${res.status}): ${message}`);
    }
    return {
      voiceId: String(parsed.voice_id ?? ""),
      voiceName: String(parsed.voice_name ?? name),
      previewAudioUrl: (parsed.preview_audio_url as string | undefined) ?? null,
    };
  });

/**
 * Search ElevenLabs shared/community voices by name.
 * Requires ELEVENLABS_API_KEY; returns [] with a hint if not configured.
 */
export const searchElevenLabsVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { query: string }) => input)
  .handler(async ({ data, context }) => {
    const workspaceId = (context as any).workspaceId ?? null;

    // Prefer the workspace-level ElevenLabs key, fall back to platform key.
    let elKey: string | null = process.env.ELEVENLABS_API_KEY ?? null;
    if (workspaceId) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("elevenlabs_api_key" as never)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        const wsKey = (ws as any)?.elevenlabs_api_key ?? null;
        if (wsKey) elKey = wsKey;
      } catch { /* column may not exist yet — ignore */ }
    }

    if (!elKey) {
      return {
        voices: [] as Array<{
          voice_id: string;
          name: string;
          description: string | null;
          labels: Record<string, string>;
          preview_url: string | null;
          public_owner_id: string | null;
        }>,
        missingKey: true,
      };
    }

    const q = encodeURIComponent((data.query ?? "").trim());
    const url = `https://api.elevenlabs.io/v1/shared-voices?page_size=20${q ? `&search=${q}` : ""}`;
    const res = await fetch(url, {
      headers: { "xi-api-key": elKey },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ElevenLabs voices API ${res.status}: ${txt}`);
    }
    const json = (await res.json()) as {
      voices?: Array<{
        voice_id: string;
        name: string;
        description?: string;
        labels?: Record<string, string>;
        preview_url?: string;
        public_owner_id?: string;
      }>;
    };
    return {
      voices: (json.voices ?? []).map((v) => ({
        voice_id: v.voice_id,
        name: v.name,
        description: v.description ?? null,
        labels: v.labels ?? {},
        preview_url: v.preview_url ?? null,
        public_owner_id: v.public_owner_id ?? null,
      })),
      missingKey: false,
    };
  });

/**
 * Generate a short TTS preview for an ElevenLabs voice using the user's text.
 * Returns the audio as a base64-encoded MP3 string so the client can play it
 * without exposing the API key.  Falls back gracefully when no key is present.
 */
export const previewElevenLabsVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { voiceId: string; text: string }) => input)
  .handler(async ({ data, context }) => {
    const workspaceId = (context as any).workspaceId ?? null;

    // Resolve key — same logic as searchElevenLabsVoices.
    let elKey: string | null = process.env.ELEVENLABS_API_KEY ?? null;
    if (workspaceId) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("elevenlabs_api_key" as never)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        const wsKey = (ws as any)?.elevenlabs_api_key ?? null;
        if (wsKey) elKey = wsKey;
      } catch { /* column may not exist yet — ignore */ }
    }

    if (!elKey) return { audio: null, missingKey: true };

    const voiceId = data.voiceId.trim();
    const text = (data.text ?? "").trim().slice(0, 500) || "Hello! How can I assist you today?";

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      },
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS ${res.status}: ${txt}`);
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { audio: base64, missingKey: false };
  });

/**
 * Generate a short TTS preview for a Retell voice using the user's text.
 * Returns the audio as a base64-encoded MP3 string so the client can play it
 * without exposing the API key.  Falls back gracefully when TTS is unavailable.
 */
export const previewRetellVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { voiceId: string; text: string }) => input)
  .handler(async ({ data, context }) => {
    const workspaceId = (context as any).workspaceId ?? null;

    // Prefer the workspace's own Retell key (workspace_settings.retell_workspace_id);
    // fall back to the platform RETELL_API_KEY env var — same resolution order used
    // by the deploy function.
    let retellKey: string | null = process.env.RETELL_API_KEY ?? null;
    if (workspaceId) {
      try {
        const { data: ws } = await supabaseAdmin
          .from("workspace_settings")
          .select("retell_workspace_id")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        const wsKey = (ws?.retell_workspace_id as string | undefined)?.trim() ?? null;
        if (wsKey) retellKey = wsKey;
      } catch { /* column may not exist yet — fall through to env key */ }
    }

    if (!retellKey) return { audio: null, missingKey: true };

    const voiceId = data.voiceId.trim();
    const text = (data.text ?? "").trim().slice(0, 500) || "Hello! How can I assist you today?";

    const res = await fetch(`${RETELL_BASE}/create-tts-audio`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${retellKey}`,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ voice_id: voiceId, text }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Retell TTS ${res.status}: ${txt}`);
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return { audio: base64, missingKey: false };
  });

/**
 * Register an ElevenLabs community voice with Retell, creating a
 * custom_voice_xxx entry that can be used in an agent.
 */
export const addElevenLabsCommunityVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { elevenLabsVoiceId: string; voiceName: string; publicOwnerId?: string | null }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.RETELL_API_KEY;
    if (!apiKey) throw new Error("RETELL_API_KEY is not configured");
    if (!data.elevenLabsVoiceId.trim()) throw new Error("ElevenLabs voice ID required");

    const body: Record<string, string> = {
      voice_name: data.voiceName.trim() || data.elevenLabsVoiceId,
      voice_provider: "elevenlabs",
      provider_voice_id: data.elevenLabsVoiceId.trim(),
    };
    if (data.publicOwnerId) body.public_user_id = data.publicOwnerId;

    const res = await fetch(`${RETELL_BASE}/add-community-voice`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = text ? JSON.parse(text) : {}; } catch { /* raw */ }
    if (!res.ok) {
      const message = (parsed.message as string | undefined) || text || res.statusText;
      throw new Error(`Retell /add-community-voice ${res.status}: ${message}`);
    }
    return {
      voiceId: String(parsed.voice_id ?? ""),
      voiceName: String(parsed.voice_name ?? data.voiceName),
    };
  });
