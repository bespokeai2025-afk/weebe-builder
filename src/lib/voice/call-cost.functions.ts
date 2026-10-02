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

export const getTestCallCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .validator((input) => z.object({ callId: z.string().min(1) }).parse(input))
  .handler(async ({ data }): Promise<TestCallCost> => {
    const sb = supabaseAdmin as any;

    const [{ data: call }, { data: turns }] = await Promise.all([
      sb
        .from("calls")
        .select("cost_cents, duration_seconds, workspace_id, call_type, to_number, stt_provider, tts_provider")
        .eq("retell_call_id", data.callId)
        .maybeSingle(),
      sb.from("call_turns").select("engine").eq("call_id", data.callId).limit(1),
    ]);

    const durationSeconds = (call?.duration_seconds as number | null) ?? null;
    const isNative = ((turns ?? [])[0] as { engine?: string } | undefined)?.engine === "webee_native";

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
              .in("provider_category", ["stt", "tts", "telephony"])
          : Promise.resolve({ data: [] as VoiceProviderRateRow[] }),
      ]);

      if (blendedRates) {
        const minutes = durationSeconds / 60;
        // LLM/router/analysis/concurrency stay on the blended rate — there is no single
        // "provider" to differentiate those by (see voice-provider-rates.ts's module doc).
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
          sttProvider: (call?.stt_provider as string | null) ?? null,
          ttsProvider: (call?.tts_provider as string | null) ?? null,
          callType: isWebCall ? "web_call" : "phone_call",
          direction: call?.call_type === "inbound" ? "inbound" : "outbound",
        });

        const llmCents = toCents(perMin.llm * minutes);
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
      costCents: (call?.cost_cents as number | null) ?? null,
      durationSeconds,
      breakdown,
    };
  });
