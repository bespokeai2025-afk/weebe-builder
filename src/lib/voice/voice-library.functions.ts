/**
 * Server side of the voice picker: list a provider's voices, speak a preview exactly as a call
 * would, and clone a voice on providers that support it.
 *
 * Provider keys never leave the server. A preview goes through `lockCallVoiceProfile` and the same
 * TTS provider classes a live call uses, so the agent's speed, volume and temperature sound the
 * same here as on the phone.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { lookupWorkspaceVoiceApiKey } from "@/lib/voice/stt/workspace-key";
import {
  createFishClone,
  listFishVoicesCached,
  resolveFishApiKey,
} from "@/lib/voice/fish-voices.functions";
import { lockCallVoiceProfile } from "@/lib/voice/call-voice-profile.shared";
import { createTtsProvider } from "@/lib/voice/tts";
import { CARTESIA_VERSION } from "@/lib/voice/tts/cartesia.provider";
import { cartesiaCatalogApiVersion } from "@/lib/voice/engine-config.shared";
import {
  accentById,
  accentFromText,
  DEFAULT_PREVIEW_TEXT,
  genderFromTags,
  isVoiceLibraryProvider,
  openAiLibraryVoices,
  VOICE_PROVIDERS,
  type LibraryVoice,
  type VoiceGender,
  type VoiceLibraryProvider,
  type VoiceLibraryQuery,
  type VoiceLibraryResult,
} from "./voice-library.shared";

const CARTESIA_API = "https://api.cartesia.ai";
const REQUEST_TIMEOUT_MS = 10_000;
/** A clone uploads up to 20 MB and the provider trains on it before answering. */
const CLONE_TIMEOUT_MS = 90_000;
const PREVIEW_SAMPLE_RATE = 24_000;
const PREVIEW_MAX_CHARS = 300;

function workspaceOf(context: unknown): string | null {
  return (context as { workspaceId?: string | null }).workspaceId ?? null;
}

async function cartesiaKey(workspaceId: string | null): Promise<string> {
  const key =
    (await lookupWorkspaceVoiceApiKey(
      supabaseAdmin as never,
      workspaceId ?? undefined,
      "cartesia",
    )) || String(process.env.CARTESIA_API_KEY ?? "").trim();
  if (!key)
    throw new Error("Add a Cartesia API key under Settings → Integrations → Voice Engines.");
  return key;
}

async function fishKey(workspaceId: string | null): Promise<string> {
  const key = await resolveFishApiKey(workspaceId);
  if (!key) {
    throw new Error("Add a Fish Audio API key under Settings → Integrations → Voice Engines.");
  }
  return key;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// ── Fish ────────────────────────────────────────────────────────────────────────────────────────

async function listFish(
  workspaceId: string | null,
  q: VoiceLibraryQuery,
): Promise<VoiceLibraryResult> {
  const apiKey = await fishKey(workspaceId);
  const accent = accentById(q.accent);
  // Fish filters on one tag at a time: gender goes to Fish, and an accent with it is matched here
  // on the tags that come back. An accent on its own is the tag.
  const tag = q.gender && q.gender !== "neutral" ? q.gender : accent?.id;
  const page = Math.max(1, q.page ?? 1);
  const result = await listFishVoicesCached(workspaceId, apiKey, {
    search: q.search?.trim() || undefined,
    language: q.language ?? "en",
    tag,
    page,
  });

  let voices: LibraryVoice[] = result.voices.map((v) => ({
    id: v.voiceId,
    name: v.title,
    description: v.description ?? undefined,
    gender: genderFromTags(v.tags),
    accent: accentFromText(v.tags),
    language: v.languages[0],
    tags: v.tags,
    owned: v.owned,
    sampleUrl: v.sampleUrl,
  }));
  if (q.source === "mine") voices = voices.filter((v) => v.owned);
  if (accent && tag !== accent.id) voices = voices.filter((v) => v.accent === accent.id || v.owned);
  return { voices, hasMore: q.source === "mine" ? false : result.hasMore, page };
}

// ── Cartesia ────────────────────────────────────────────────────────────────────────────────────

const CARTESIA_GENDER: Record<VoiceGender, string> = {
  male: "masculine",
  female: "feminine",
  neutral: "gender_neutral",
};

function cartesiaGender(value: unknown): VoiceGender | undefined {
  if (value === "masculine") return "male";
  if (value === "feminine") return "female";
  if (value === "gender_neutral") return "neutral";
  return undefined;
}

function mapCartesiaVoice(v: Record<string, unknown>): LibraryVoice | null {
  const id = str(v.id);
  if (!id) return null;
  const accents = Array.isArray(v.accents) ? (v.accents as Array<Record<string, unknown>>) : [];
  const tagline = str(v.tagline);
  return {
    id,
    name: str(v.name) || id,
    description: str(v.description) || tagline || undefined,
    gender: cartesiaGender(v.gender),
    accent: accentFromText([
      ...accents.map((a) => str(a.locale)),
      ...accents.map((a) => str(a.accent)),
      str(v.language) && str(v.country) ? `${str(v.language)}-${str(v.country)}` : "",
    ]),
    language: str(v.language) || undefined,
    tags: tagline ? [tagline] : [],
    owned: v.is_owner === true,
    sampleUrl: /^https:\/\//i.test(str(v.preview_file_url)) ? str(v.preview_file_url) : undefined,
  };
}

async function listCartesia(
  workspaceId: string | null,
  q: VoiceLibraryQuery,
): Promise<VoiceLibraryResult> {
  const key = await cartesiaKey(workspaceId);
  const accent = accentById(q.accent);
  const params = new URLSearchParams({ limit: "100" });
  if (q.search?.trim()) params.set("q", q.search.trim());
  if (q.source === "mine") params.set("is_owner", "true");

  const current = new URLSearchParams(params);
  if (q.gender) current.set("gender", CARTESIA_GENDER[q.gender]);
  if (accent) current.set("language", accent.locale);
  current.append("expand[]", "preview_file_url");

  const headers = (version: string) => ({
    Authorization: `Bearer ${key}`,
    "X-API-Key": key,
    "Cartesia-Version": version,
  });

  let res = await fetchWithTimeout(`${CARTESIA_API}/voices?${current}`, {
    headers: headers(cartesiaCatalogApiVersion()),
  });
  let filteredHere = false;
  if (res.status === 400 || res.status === 404 || res.status === 422) {
    // Older API version: no gender/locale filters or preview URLs — filter on what comes back.
    await res.body?.cancel().catch(() => {});
    res = await fetchWithTimeout(`${CARTESIA_API}/voices?${params}`, {
      headers: headers(CARTESIA_VERSION),
    });
    filteredHere = true;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Cartesia voice library unavailable (HTTP ${res.status}) ${body.slice(0, 200)}`,
    );
  }
  const json = (await res.json()) as { data?: Array<Record<string, unknown>>; has_more?: boolean };
  let voices = (json.data ?? [])
    .filter((v) => v.status !== "archived")
    .map(mapCartesiaVoice)
    .filter((v): v is LibraryVoice => v !== null);
  if (filteredHere) {
    if (q.gender) voices = voices.filter((v) => v.gender === q.gender);
    if (accent) voices = voices.filter((v) => v.accent === accent.id);
  }
  // Own clones first, then the library as Cartesia orders it.
  voices.sort((a, b) => Number(b.owned) - Number(a.owned));
  return { voices, hasMore: false, page: 1 };
}

// ── Server functions ────────────────────────────────────────────────────────────────────────────

/** One page of a provider's voices for the picker. */
export const listLibraryVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: VoiceLibraryQuery) => {
    if (!isVoiceLibraryProvider(input?.provider)) throw new Error("Unknown voice provider");
    return input;
  })
  .handler(async ({ context, data }): Promise<VoiceLibraryResult> => {
    const workspaceId = workspaceOf(context);
    if (data.provider === "fish") return listFish(workspaceId, data);
    if (data.provider === "cartesia") return listCartesia(workspaceId, data);
    return { voices: openAiLibraryVoices(data.search), hasMore: false, page: 1 };
  });

export interface VoicePreviewInput {
  provider: VoiceLibraryProvider;
  voiceId: string;
  text?: string;
  model?: string;
  /** The agent's voice settings as they will be saved: speed, volume, temperature, emotion… */
  settings?: Record<string, unknown>;
}

/** Speak a line in a voice with the given settings, the way a call would. Returns base64 WAV. */
export const previewLibraryVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: VoicePreviewInput) => {
    if (!isVoiceLibraryProvider(input?.provider)) throw new Error("Unknown voice provider");
    if (!String(input.voiceId ?? "").trim()) throw new Error("Pick a voice to hear it.");
    return input;
  })
  .handler(async ({ context, data }) => {
    const workspaceId = workspaceOf(context);
    const provider = data.provider;
    const voiceId = data.voiceId.trim();
    const text = (data.text ?? "").trim().slice(0, PREVIEW_MAX_CHARS) || DEFAULT_PREVIEW_TEXT;
    const settings: Record<string, unknown> = {
      ...(data.settings ?? {}),
      webeeTtsProvider: provider,
      ...(provider === "fish" ? { webeeVoiceId: voiceId } : {}),
      ...(provider === "cartesia" ? { cartesiaVoice: voiceId } : {}),
      ...(provider === "openai" ? { openaiVoice: voiceId } : {}),
    };

    const tts = createTtsProvider(provider, {
      fishApiKey: provider === "fish" ? await fishKey(workspaceId) : undefined,
      cartesiaApiKey: provider === "cartesia" ? await cartesiaKey(workspaceId) : undefined,
      openaiApiKey: process.env.OPENAI_API_KEY,
      fishTtsModel: provider === "fish" ? data.model : undefined,
      cartesiaTtsModel: provider === "cartesia" ? data.model : undefined,
      openaiTtsModel: provider === "openai" ? data.model : undefined,
      openaiTtsInstructions:
        provider === "openai" ? str(settings.webeeTtsInstructions) || undefined : undefined,
    });
    const profile = lockCallVoiceProfile({
      sessionVoiceId: provider === "fish" ? voiceId : undefined,
      settings,
      sampleRate: PREVIEW_SAMPLE_RATE,
      model: data.model,
      ttsProvider: provider,
    });

    const chunks: Buffer[] = [];
    for await (const chunk of tts.synthesize(text, { ...profile, latency: "low" }))
      chunks.push(chunk);
    const pcm = Buffer.concat(chunks);
    if (!pcm.byteLength) throw new Error("The voice returned no audio.");
    return {
      audio: pcm16ToWav(pcm, PREVIEW_SAMPLE_RATE).toString("base64"),
      mimeType: "audio/wav" as const,
    };
  });

export interface CloneVoiceInput {
  provider: VoiceLibraryProvider;
  name: string;
  audioBase64: string;
  fileName?: string;
  mimeType?: string;
  /** ISO 639-1, for providers that need it (Cartesia). */
  language?: string;
}

/** Clone a voice from an audio sample on a provider that supports it. */
export const cloneLibraryVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: CloneVoiceInput) => {
    if (!isVoiceLibraryProvider(input?.provider)) throw new Error("Unknown voice provider");
    if (!VOICE_PROVIDERS[input.provider].clone) {
      throw new Error(`${VOICE_PROVIDERS[input.provider].label} doesn't support voice cloning.`);
    }
    if (!String(input.name ?? "").trim()) throw new Error("Give the voice a name.");
    return input;
  })
  .handler(async ({ context, data }): Promise<{ id: string; name: string }> => {
    const workspaceId = workspaceOf(context);
    const name = data.name.trim().slice(0, 100);
    const audio = Buffer.from(data.audioBase64, "base64");
    const maxBytes = VOICE_PROVIDERS[data.provider].cloneMaxBytes ?? 0;
    if (!audio.byteLength) throw new Error("The audio file is empty.");
    if (maxBytes && audio.byteLength > maxBytes) {
      throw new Error(`The audio must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`);
    }
    const fileName = data.fileName?.trim() || "sample.wav";

    if (data.provider === "fish") {
      const clone = await createFishClone(workspaceId, {
        title: name,
        audio,
        fileName,
        mimeType: data.mimeType,
      });
      return { id: clone.voiceId, name: clone.title };
    }

    const key = await cartesiaKey(workspaceId);
    const form = new FormData();
    form.append(
      "clip",
      new Blob([new Uint8Array(audio)], { type: data.mimeType || "audio/wav" }),
      fileName,
    );
    form.append("name", name);
    form.append("language", (data.language || "en").slice(0, 2).toLowerCase());
    const res = await fetchWithTimeout(
      `${CARTESIA_API}/voices/clone`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "X-API-Key": key,
          "Cartesia-Version": cartesiaCatalogApiVersion(),
        },
        body: form,
      },
      CLONE_TIMEOUT_MS,
    );
    if (!res.ok)
      throw new Error(
        `Cartesia couldn't clone the voice (HTTP ${res.status}): ${await res.text().catch(() => "")}`,
      );
    const json = (await res.json()) as Record<string, unknown>;
    const id = str(json.id);
    if (!id) throw new Error("Cartesia did not return a voice id.");
    return { id, name: str(json.name) || name };
  });

function pcm16ToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}
