/**
 * Fish Audio credentials + voice catalog for the Builder UI.
 *
 * The API key lives in `provider_settings` (category "voice", name "fish") so
 * it uses the Universal Provider Framework rather than adding another legacy
 * credential column to workspace_settings. Keys are read server-side only and
 * never returned to the client in full — callers get a masked value.
 *
 * Voice models come from GET https://api.fish.audio/model:
 *   ?self=true           -> models this workspace owns (its own clones)
 *   ?language=en         -> filter by language
 *   ?title=...           -> fuzzy search across the public Voice Library
 *   ?sort_by=task_count  -> popular voices first
 * The `_id` of a model is what TTS takes as `reference_id`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FishAudioTtsProvider } from "./tts/fish.provider";

const FISH_API_BASE = "https://api.fish.audio";
const CACHE_TTL_MS = 10 * 60 * 1000;
const PAGE_SIZE = 50;
const PREVIEW_SAMPLE_RATE = 24_000;

export interface FishVoice {
  /** Pass this to TTS as `reference_id`. */
  voiceId: string;
  title: string;
  languages: string[];
  tags: string[];
  description: string | null;
  /** True when the workspace owns this model (its own clone). */
  owned: boolean;
}

export interface ListFishVoicesInput {
  /** Fuzzy title search across the public library. */
  search?: string;
  /** `en` (default browse), `all`, or a Fish language code. */
  language?: string;
  /** Fish tag filter, e.g. male, female, narration. */
  tag?: string;
  page?: number;
}

export interface FishVoiceListResult {
  voices: FishVoice[];
  total: number;
  hasMore: boolean;
  page: number;
}

interface FishModelItem {
  _id?: string;
  id?: string;
  title?: string;
  description?: string | null;
  languages?: string[];
  tags?: string[];
}

interface FishModelResponse {
  items?: FishModelItem[];
  total?: number;
  page_number?: number;
  page_size?: number;
}

/**
 * Resolve the Fish Audio key for a workspace, preferring the workspace's own
 * credential and falling back to the platform key.
 */
export async function resolveFishApiKey(
  workspaceId: string | null | undefined,
): Promise<string | null> {
  if (workspaceId) {
    try {
      const { data } = await supabaseAdmin
        .from("provider_settings")
        .select("credentials")
        .eq("workspace_id", workspaceId)
        .eq("provider_category", "voice")
        .eq("provider_name", "fish")
        .maybeSingle();
      const creds = (data?.credentials ?? {}) as Record<string, unknown>;
      const key = typeof creds.apiKey === "string" ? creds.apiKey.trim() : "";
      if (key) return key;
    } catch {
      /* fall through to platform key */
    }
  }
  return process.env.FISH_API_KEY?.trim() || null;
}

/** Cache key includes every query dimension because catalogs differ per credential. */
const catalogCache = new Map<string, { at: number; result: FishVoiceListResult }>();

function mapFishItem(item: FishModelItem, owned: boolean): FishVoice | null {
  const voiceId = item._id ?? item.id ?? "";
  if (!voiceId) return null;
  return {
    voiceId,
    title: item.title ?? "Untitled voice",
    languages: item.languages ?? [],
    tags: item.tags ?? [],
    description: item.description ?? null,
    owned,
  };
}

async function fetchFishModelsPage(
  apiKey: string,
  params: Record<string, string>,
): Promise<{ voices: FishVoice[]; total: number; hasMore: boolean }> {
  const query = new URLSearchParams({
    page_size: String(PAGE_SIZE),
    ...params,
  });
  const res = await fetch(`${FISH_API_BASE}/model?${query.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    throw new Error(`Voice catalog unavailable (${res.status}): ${body}`);
  }
  const json = (await res.json()) as FishModelResponse;
  const owned = params.self === "true";
  const voices = (json.items ?? [])
    .map((item) => mapFishItem(item, owned))
    .filter((v): v is FishVoice => v !== null);

  const total = json.total ?? voices.length;
  const page = Number(params.page_number ?? "1");
  const pageSize = Number(params.page_size ?? PAGE_SIZE);
  const hasMore = page * pageSize < total;
  return { voices, total, hasMore };
}

/** Merge lists, owned voices first, deduped by id. */
export function mergeFishVoiceLists(...lists: FishVoice[][]): FishVoice[] {
  const seen = new Set<string>();
  const out: FishVoice[] = [];
  for (const list of lists) {
    for (const v of list) {
      if (seen.has(v.voiceId)) continue;
      seen.add(v.voiceId);
      out.push(v);
    }
  }
  return out;
}

function matchesLocalSearch(voice: FishVoice, term: string): boolean {
  const q = term.toLowerCase();
  return (
    voice.title.toLowerCase().includes(q) ||
    voice.tags.some((t) => t.toLowerCase().includes(q)) ||
    voice.languages.some((l) => l.toLowerCase().includes(q)) ||
    (voice.description?.toLowerCase().includes(q) ?? false)
  );
}

function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
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

async function listFishVoicesInternal(
  apiKey: string,
  input: ListFishVoicesInput,
): Promise<FishVoiceListResult> {
  const search = input.search?.trim() ?? "";
  const language = input.language?.trim() || "en";
  const tag = input.tag?.trim() ?? "";
  const page = Math.max(1, input.page ?? 1);

  const ownedPage = await fetchFishModelsPage(apiKey, {
    self: "true",
    page_number: String(page),
  });

  if (search) {
    const libParams: Record<string, string> = {
      title: search,
      page_number: String(page),
      sort_by: "task_count",
    };
    if (language !== "all") libParams.language = language;
    if (tag) libParams.tag = tag;
    const searchPage = await fetchFishModelsPage(apiKey, libParams);
    const ownedMatches = ownedPage.voices.filter((v) => matchesLocalSearch(v, search));
    const voices = mergeFishVoiceLists(ownedMatches, searchPage.voices);
    return {
      voices,
      total: voices.length,
      hasMore: searchPage.hasMore,
      page,
    };
  }

  // Browse: owned clones + English library + curated narrator voices for agent building.
  const libParams: Record<string, string> = {
    page_number: String(page),
    sort_by: "task_count",
  };
  if (language !== "all") libParams.language = language;
  if (tag) libParams.tag = tag;

  const curatedParams: Record<string, string> | null = tag
    ? null
    : {
        title: "narrator",
        page_number: "1",
        page_size: "30",
        sort_by: "task_count",
        ...(language !== "all" ? { language } : { language: "en" }),
      };

  const [libraryPage, curatedPage] = await Promise.all([
    fetchFishModelsPage(apiKey, libParams),
    curatedParams
      ? fetchFishModelsPage(apiKey, curatedParams)
      : Promise.resolve({ voices: [] as FishVoice[], total: 0, hasMore: false }),
  ]);

  const voices = mergeFishVoiceLists(ownedPage.voices, curatedPage.voices, libraryPage.voices);
  return {
    voices,
    total: libraryPage.total + ownedPage.voices.length,
    hasMore: libraryPage.hasMore,
    page,
  };
}

/**
 * List Fish Audio voices for the Builder.
 *
 * Default browse (no search): workspace clones + popular English library voices.
 * Search: fuzzy title match in the library, merged with owned voices matching locally.
 */
export const listFishVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: ListFishVoicesInput | undefined) => input ?? {})
  .handler(async ({ context, data }): Promise<FishVoiceListResult> => {
    const workspaceId = context.workspaceId ?? null;
    const apiKey = await resolveFishApiKey(workspaceId);
    if (!apiKey) {
      throw new Error(
        "WEBEE Native voice is not connected. Add a Fish Audio API key under Settings → Integrations → Voice Engines, or set FISH_API_KEY in your environment.",
      );
    }

    const cacheKey = `${workspaceId ?? "platform"}:${JSON.stringify(data)}`;
    const cached = catalogCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.result;

    const result = await listFishVoicesInternal(apiKey, data);
    catalogCache.set(cacheKey, { at: now, result });
    return result;
  });

/** Look up a single voice by id (for selected-voice chip when off-page). */
export const getFishVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { voiceId: string }) => input)
  .handler(async ({ context, data }): Promise<FishVoice | null> => {
    const voiceId = data.voiceId?.trim();
    if (!voiceId) return null;
    const workspaceId = context.workspaceId ?? null;
    const apiKey = await resolveFishApiKey(workspaceId);
    if (!apiKey) return null;

    // Fish has no single-model GET in our integration — search by scanning owned + id match in a small library query.
    const owned = await fetchFishModelsPage(apiKey, { self: "true", page_number: "1" });
    const hit = owned.voices.find((v) => v.voiceId === voiceId);
    if (hit) return hit;

    return {
      voiceId,
      title: data.voiceId.slice(0, 8) + "…",
      languages: [],
      tags: [],
      description: null,
      owned: false,
    };
  });

/** Short TTS preview — returns base64 WAV so the client can play without exposing the API key. */
export const previewFishVoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { voiceId: string; text: string }) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId ?? null;
    const apiKey = await resolveFishApiKey(workspaceId);
    if (!apiKey) return { audio: null, missingKey: true, mimeType: "audio/wav" as const };

    const voiceId = data.voiceId.trim();
    const text =
      (data.text ?? "").trim().slice(0, 500) || "Hi there! How can I help you today?";

    const provider = new FishAudioTtsProvider(apiKey);
    const chunks: Buffer[] = [];
    for await (const chunk of provider.synthesize(text, {
      voiceId,
      sampleRate: PREVIEW_SAMPLE_RATE,
      latency: "low",
    })) {
      chunks.push(chunk);
    }
    const pcm = Buffer.concat(chunks);
    if (pcm.byteLength === 0) {
      return { audio: null, missingKey: false, mimeType: "audio/wav" as const };
    }
    const wav = pcmToWav(pcm, PREVIEW_SAMPLE_RATE);
    return {
      audio: wav.toString("base64"),
      missingKey: false,
      mimeType: "audio/wav" as const,
    };
  });

/** Connection status for the settings UI. Never returns the raw key. */
export const getFishApiKeyStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId ?? null;
    let workspaceKey: string | null = null;
    if (workspaceId) {
      try {
        const { data } = await supabaseAdmin
          .from("provider_settings")
          .select("credentials")
          .eq("workspace_id", workspaceId)
          .eq("provider_category", "voice")
          .eq("provider_name", "fish")
          .maybeSingle();
        const creds = (data?.credentials ?? {}) as Record<string, unknown>;
        workspaceKey = typeof creds.apiKey === "string" ? creds.apiKey.trim() || null : null;
      } catch {
        workspaceKey = null;
      }
    }
    const platformKey = process.env.FISH_API_KEY?.trim() || null;
    const effective = workspaceKey ?? platformKey;

    return {
      connected: !!effective,
      usingPlatformKey: !workspaceKey && !!platformKey,
      masked: effective ? `...${effective.slice(-4)}` : null,
    };
  });

export const saveFishApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { key: string }) => input)
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const key = data.key?.trim() ?? "";
    const { error } = await supabaseAdmin.from("provider_settings").upsert(
      {
        workspace_id: workspaceId,
        provider_category: "voice",
        provider_name: "fish",
        credentials: key ? { apiKey: key } : {},
        status: key ? "connected" : "disconnected",
      },
      { onConflict: "workspace_id,provider_category,provider_name" },
    );
    if (error) throw new Error(`Could not save the voice engine key: ${error.message}`);

    for (const cacheKey of catalogCache.keys()) {
      if (cacheKey.startsWith(`${workspaceId}:`)) catalogCache.delete(cacheKey);
    }
    return { ok: true, connected: !!key };
  });
