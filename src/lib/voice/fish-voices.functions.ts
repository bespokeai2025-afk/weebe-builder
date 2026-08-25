/**
 * Fish Audio credentials + voice catalog for the Builder UI.
 *
 * The API key lives in `provider_settings` (category "voice", name "fish") so
 * it uses the Universal Provider Framework rather than adding another legacy
 * credential column to workspace_settings. Keys are read server-side only and
 * never returned to the client in full — callers get a masked value.
 *
 * Voice models come from GET https://api.fish.audio/model:
 *   ?self=true  -> models this workspace owns (its own clones)
 *   ?title=...  -> fuzzy search across the public Voice Library
 * The `_id` of a model is what TTS takes as `reference_id`.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const FISH_API_BASE = "https://api.fish.audio";
const CACHE_TTL_MS = 10 * 60 * 1000;

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

/** Combine owned and library results without showing a duplicate library voice. */
export function mergeFishVoiceLists(owned: FishVoice[], library: FishVoice[]): FishVoice[] {
  const seen = new Set<string>();
  return [...owned, ...library].filter((voice) => {
    if (seen.has(voice.voiceId)) return false;
    seen.add(voice.voiceId);
    return true;
  });
}

interface FishModelItem {
  _id?: string;
  id?: string;
  title?: string;
  description?: string | null;
  languages?: string[];
  tags?: string[];
}

/**
 * Resolve the Fish Audio key for a workspace, preferring the workspace's own
 * credential and falling back to the platform key.
 *
 * Server-only: this returns the raw key and must never be exposed via a server
 * function response.
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
      // Table may not exist in older environments — fall through to the env key.
    }
  }
  return process.env.FISH_API_KEY?.trim() || null;
}

/** Cache key includes the workspace because catalogs differ per credential. */
const catalogCache = new Map<string, { at: number; voices: FishVoice[] }>();

async function fetchFishModels(
  apiKey: string,
  params: Record<string, string>,
): Promise<FishVoice[]> {
  const query = new URLSearchParams({ page_size: "100", ...params });
  const res = await fetch(`${FISH_API_BASE}/model?${query.toString()}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => String(res.status));
    // Surfaced in the builder's voice picker, so it stays vendor-neutral.
    throw new Error(`Voice catalog unavailable (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { items?: FishModelItem[] };
  const owned = params.self === "true";

  return (json.items ?? [])
    .map((item): FishVoice | null => {
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
    })
    .filter((v): v is FishVoice => v !== null);
}

/**
 * List Fish Audio voices available to this workspace.
 *
 * With no search term this returns the workspace's own cloned models. Passing a
 * `search` term queries the public Voice Library instead, so users can adopt a
 * library voice without cloning anything.
 */
export const listFishVoices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { search?: string } | undefined) => input ?? {})
  .handler(async ({ context, data }): Promise<FishVoice[]> => {
    const workspaceId = context.workspaceId ?? null;
    const apiKey = await resolveFishApiKey(workspaceId);
    if (!apiKey) {
      throw new Error(
        "WEBEE Native voice is not connected. Add a key under Settings → Integrations → Voice Engines.",
      );
    }

    const search = data.search?.trim() ?? "";
    const cacheKey = `${workspaceId ?? "platform"}:${search}`;
    const cached = catalogCache.get(cacheKey);
    const now = Date.now();
    if (cached && now - cached.at < CACHE_TTL_MS) return cached.voices;

    const voices = search
      ? await fetchFishModels(apiKey, { title: search })
      : await fetchFishModels(apiKey, { self: "true" });

    catalogCache.set(cacheKey, { at: now, voices });
    return voices;
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
      /** True when falling back to the platform key rather than a workspace key. */
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

    // Drop cached catalogs for this workspace so the new key takes effect now.
    for (const cacheKey of catalogCache.keys()) {
      if (cacheKey.startsWith(`${workspaceId}:`)) catalogCache.delete(cacheKey);
    }
    return { ok: true, connected: !!key };
  });
