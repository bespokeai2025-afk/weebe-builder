/**
 * Test-call cost — admin only.
 *
 * `calls.cost_cents` is now populated on call_ended/call_analyzed (previously
 * computed correctly but never persisted — see the fix in
 * retell-webhook.processor.ts). This reads it back for the builder's Cost tab,
 * and for a native-engine call adds a per-component breakdown using the same
 * rate table the admin cost-engine dashboard edits, so an admin can see not
 * just what a test call cost but where that cost came from.
 *
 * Platform-admin gated deliberately: this is real COGS/margin data, and a
 * workspace's own "admin" role member is a customer, not staff.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { calcWebeeNativeCostPerMin, type WebeeNativeCost } from "@/lib/cost-engine/native-rates";
import {
  calcVoiceProviderCostBreakdown,
  type TelephonyBasis,
  type VoiceProviderRateRow,
} from "@/lib/cost-engine/voice-provider-rates";

export interface TestCallCost {
  callId: string;
  costCents: number | null;
  durationSeconds: number | null;
  /** Only set for a webee_native call, when current rates are configured. */
  breakdown: {
    ratesAsOf: string;
    /** Provider-specific when `calls.stt_provider`/`tts_provider` and a matching rate are both
     * present; falls back to the blended per-minute figure otherwise (an older call made before
     * provider tracking existed, or a provider with no seeded rate yet). */
    ttsCents: number;
    ttsProvider: string | null;
    ttsRateMissing: boolean;
    sttCents: number;
    sttProvider: string | null;
    sttRateMissing: boolean;
    llmCents: number;
    llmProvider: string | null;
    llmRateMissing: boolean;
    routerCents: number;
    analysisCents: number;
    concurrencyCents: number;
    /** Engine-only — STT+TTS+LLM+router+analysis+concurrency. Matches `calls.cost_cents`'
     * existing meaning, so a real phone call's carrier minutes are never double-counted here. */
    totalCents: number;
    telephonyCents: number;
    telephonyBasis: TelephonyBasis;
    /** True only for a web test call (no real carrier to reconcile against) — see `totalCents`. */
    telephonyIncludedInTotal: boolean;
    /** `totalCents` plus telephony when it's a web call; equals `totalCents` otherwise. */
    estimatedTotalCents: number;
  } | null;
}

/**
 * Whether to even show the Cost tab. Deliberately not gated by
 * `requirePlatformAdmin` — that throws, and a non-admin calling this to decide
 * whether to render a tab is not an access violation, just a "no" answer.
 * Mirrors the exact check `requirePlatformAdmin` enforces server-side, so a
 * user who sees the tab is always one who can actually load it.
 */
export const checkCanSeeCallCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ canSee: boolean }> => {
    const { supabase, userId } = context as any;
    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
    ]);
    const canSee = profileRes.data?.user_type === "admin" || !!roleRes.data;
    return { canSee };
  });

/** PostgREST returns NUMERIC as a string; anything unparseable is treated as absent. */
function coercePrecise(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const getTestCallCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .validator((input) => z.object({ callId: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<TestCallCost> => {
    const sb = supabaseAdmin as any;

    /**
     * Exactly the columns selected below. `sb` has to stay `any` because the generated
     * Supabase types have not been regenerated since `llm_provider` was added — but typing
     * the ROW means removing a column from the select becomes a compile error instead of a
     * silent `undefined`, which is how `llm_provider` was read here for a while while never
     * being selected, quietly disabling per-provider LLM pricing on this surface.
     */
    type CostCallRow = {
      cost_cents: number | null;
      cost_cents_precise: number | string | null;
      duration_seconds: number | null;
      workspace_id: string | null;
      call_type: string | null;
      to_number: string | null;
      stt_provider: string | null;
      tts_provider: string | null;
      llm_provider: string | null;
    };

    // Selecting a column that does not exist makes PostgREST reject the ENTIRE query, so a
    // not-yet-applied migration would blank the whole Cost panel rather than just omit the
    // extra precision. Ask for it, and fall back to the columns that have always existed.
    const BASE_COLS =
      "cost_cents, duration_seconds, workspace_id, call_type, to_number, " +
      "stt_provider, tts_provider, llm_provider";

    const callQuery = (cols: string) =>
      sb.from("calls").select(cols).eq("retell_call_id", data.callId).maybeSingle();

    const [callRes, { data: turns }] = (await Promise.all([
      callQuery(`${BASE_COLS}, cost_cents_precise`),
      sb.from("call_turns").select("engine").eq("call_id", data.callId).limit(1),
    ])) as [
      { data: CostCallRow | null; error?: { message?: string } | null },
      { data: { engine?: string }[] | null },
    ];

    const call: CostCallRow | null = callRes.error
      ? (((await callQuery(BASE_COLS)) as { data: CostCallRow | null }).data ?? null)
      : callRes.data;

    const durationSeconds = call?.duration_seconds ?? null;
    const isNative = (turns ?? [])[0]?.engine === "webee_native";

    let breakdown: TestCallCost["breakdown"] = null;
    if (isNative && durationSeconds != null && durationSeconds > 0) {
      const [{ data: blendedRates }, { data: providerRates }] = await Promise.all([
        sb
          .from("cost_engine_webee_native")
          .select("*")
          .eq("is_current", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        call?.workspace_id
          ? sb
              .from("provider_cost_rates")
              .select("provider_category, provider_name, unit_type, cost_per_unit_usd")
              .eq("workspace_id", call.workspace_id)
              .in("provider_category", ["stt", "tts", "llm", "telephony"])
          : Promise.resolve({ data: [] as VoiceProviderRateRow[] }),
      ]);

      if (blendedRates) {
        const minutes = durationSeconds / 60;
        // Router/analysis/concurrency stay on the blended rate — those are WEBEE's own
        // overhead, with no single vendor to differentiate them by. LLM is no longer in that
        // group: it has a real provider per call, and is priced from it below.
        const perMin = calcWebeeNativeCostPerMin({
          native: blendedRates as WebeeNativeCost,
          avgCallMinutes: minutes,
        });
        const toCents = (usd: number) => Number((usd * 100).toFixed(4));

        // `calls` has no `direction` column — the webhook processor never persisted one, and a
        // prior version of this query selected it anyway, which made the whole select throw and
        // silently killed every breakdown. What the processor actually writes into `call_type` is
        // the inbound/outbound direction, not "web_call"/"phone_call" (see retell-webhook.processor
        // .ts's own `callType` local, computed from the webhook's `direction` field and written
        // straight into this column) — so that's where direction comes from here. Whether the call
        // was a browser test call at all isn't captured in any column either; `to_number` is the one
        // reliable signal ("web:test" is the sentinel the native engine writes for it).
        const isWebCall = call?.to_number === "web:test";
        const voice = calcVoiceProviderCostBreakdown({
          rates: (providerRates ?? []) as VoiceProviderRateRow[],
          durationMinutes: minutes,
          sttProvider: call?.stt_provider ?? null,
          ttsProvider: call?.tts_provider ?? null,
          llmProvider: call?.llm_provider ?? null,
          callType: isWebCall ? "web_call" : "phone_call",
          direction: call?.call_type === "inbound" ? "inbound" : "outbound",
        });

        // Same precedence as STT/TTS below: the provider that actually served the call wins;
        // the blended GPT-4.1 figure is the fallback for calls predating provider tracking.
        const llmCents = voice.llmProvider && !voice.llmRateMissing
          ? toCents(voice.llmUsd)
          : toCents(perMin.llm * minutes);
        const routerCents = toCents(perMin.router * minutes);
        const analysisCents = toCents(perMin.analysis * minutes);
        const concurrencyCents = toCents(perMin.concurrency * minutes);
        // Falls back to the blended per-minute figure when this call has no persisted provider
        // (made before provider tracking existed) or that provider has no seeded rate yet — a
        // provider-specific $0 would understate the call, not just lack detail.
        const sttCents = voice.sttProvider && !voice.sttRateMissing
          ? toCents(voice.sttUsd)
          : toCents(perMin.stt * minutes);
        const ttsCents = voice.ttsProvider && !voice.ttsRateMissing
          ? toCents(voice.ttsUsd)
          : toCents(perMin.tts * minutes);
        const telephonyCents = toCents(voice.telephonyUsd);
        const totalCents = sttCents + ttsCents + llmCents + routerCents + analysisCents + concurrencyCents;

        breakdown = {
          ratesAsOf: blendedRates.updated_at as string,
          ttsCents,
          ttsProvider: voice.ttsProvider,
          ttsRateMissing: voice.ttsRateMissing,
          sttCents,
          sttProvider: voice.sttProvider,
          sttRateMissing: voice.sttRateMissing,
          llmCents,
          llmProvider: voice.llmProvider,
          llmRateMissing: voice.llmRateMissing,
          routerCents,
          analysisCents,
          concurrencyCents,
          totalCents,
          telephonyCents,
          telephonyBasis: voice.telephonyBasis,
          telephonyIncludedInTotal: voice.telephonyIncludedInTotal,
          estimatedTotalCents: voice.telephonyIncludedInTotal
            ? totalCents + telephonyCents
            : totalCents,
        };
      }
    }

    return {
      callId: data.callId,
      // Prefer the unrounded figure. NUMERIC comes back from PostgREST as a string, so it is
      // coerced here rather than at every display site. Falls back to the rounded column for
      // rows written before `cost_cents_precise` existed.
      costCents: coercePrecise(call?.cost_cents_precise) ?? call?.cost_cents ?? null,
      durationSeconds,
      breakdown,
    };
  });
