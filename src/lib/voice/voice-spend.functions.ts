/**
 * Live voice spend for the owner — platform-admin only.
 *
 * The existing admin cost-engine page models what a minute *should* cost from editable
 * assumptions. This reports what calls *actually* cost, from the providers each call really
 * used, so the two can be compared.
 *
 * Reuses the same two rate paths the builder's Cost tab uses, so there is one source of truth:
 *   - `calcVoiceProviderCostBreakdown` — per-provider STT/TTS/LLM/telephony
 *   - `calcWebeeNativeCostPerMin`      — blended fallback for calls with no recorded provider
 *
 * Platform-admin gated deliberately: this is COGS and margin across every workspace. A
 * workspace's own "admin" is a customer, not staff.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { calcWebeeNativeCostPerMin, type WebeeNativeCost } from "@/lib/cost-engine/native-rates";
import {
  calcVoiceProviderCostBreakdown,
  type VoiceProviderRateRow,
} from "@/lib/cost-engine/voice-provider-rates";

export interface SpendCallRow {
  id: string;
  startedAt: string | null;
  agentName: string | null;
  minutes: number;
  sttProvider: string | null;
  ttsProvider: string | null;
  llmProvider: string | null;
  sttUsd: number;
  ttsUsd: number;
  llmUsd: number;
  telephonyUsd: number;
  totalUsd: number;
  /** True when any component fell back to the blended rate instead of a real provider rate. */
  estimated: boolean;
  isTestCall: boolean;
}

export interface SpendDay {
  day: string;
  calls: number;
  minutes: number;
  costUsd: number;
}

export interface LiveCall {
  id: string;
  agentName: string | null;
  startedAt: string | null;
  elapsedSeconds: number;
  /** Accrued at the blended engine rate — the real providers are only known once it ends. */
  estCostUsd: number;
}

export interface VoiceSpendDashboard {
  rangeDays: number;
  totals: {
    calls: number;
    minutes: number;
    costUsd: number;
    avgCostPerMin: number;
    sellingUsd: number;
    profitUsd: number;
    marginPct: number;
  };
  markup: { label: string; type: string; value: number } | null;
  byDay: SpendDay[];
  recent: SpendCallRow[];
  live: LiveCall[];
  providerMix: { kind: "stt" | "tts" | "llm"; provider: string; calls: number; costUsd: number }[];
  /** Share of calls whose providers were recorded. Low means most rows are estimates. */
  providerCoverage: { recorded: number; total: number };
  warnings: string[];
}

/** Mirrors `checkCanSeeCallCost` — a "no" here is an answer, not an access violation. */
export const checkCanSeeVoiceSpend = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ canSee: boolean }> => {
    const { supabase, userId } = context as any;
    const [profileRes, roleRes] = await Promise.all([
      supabase.from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle(),
    ]);
    return { canSee: profileRes.data?.user_type === "admin" || !!roleRes.data };
  });

const round = (v: number, dp = 4) => Number(v.toFixed(dp));

/** A row that never got an end written would otherwise sit in "live" forever. */
const LIVE_MAX_ELAPSED_SECONDS = 3600;

export const getVoiceSpendDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .validator((input) =>
    z
      .object({
        days: z.number().int().min(1).max(90).default(7),
        limit: z.number().int().min(1).max(200).default(50),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data }): Promise<VoiceSpendDashboard> => {
    const sb = supabaseAdmin as any;
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const warnings: string[] = [];

    const [callsRes, ratesRes, blendedRes, markupRes] = await Promise.all([
      sb
        .from("calls")
        .select(
          "id, agent_name, duration_seconds, started_at, ended_at, created_at, call_type, to_number, " +
            "stt_provider, tts_provider, llm_provider, is_test_call, call_status",
        )
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
      sb
        .from("provider_cost_rates")
        .select("provider_category, provider_name, unit_type, cost_per_unit_usd")
        .in("provider_category", ["stt", "tts", "llm", "telephony"]),
      sb.from("cost_engine_webee_native").select("*").eq("is_current", true).maybeSingle(),
      // Not `.maybeSingle()`: this table currently holds more than one row flagged active, and
      // maybeSingle rejects multiple rows outright — which silently produced a null markup and a
      // 0% margin rather than any error. Take the most recently updated one and say so below.
      sb
        .from("cost_engine_markup")
        .select("*")
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    // `llm_provider` only exists once its migration is applied. Selecting a missing column makes
    // PostgREST reject the whole query, which would blank the page rather than degrade it.
    if (callsRes.error) {
      warnings.push(
        `Call query failed (${String(callsRes.error.message).slice(0, 120)}). If it names llm_provider, apply migration 20261010000000_llm_provider_cost.sql.`,
      );
    }

    const calls = (callsRes.data ?? []) as Record<string, any>[];
    const rates = (ratesRes.data ?? []) as VoiceProviderRateRow[];
    const blended = (blendedRes.data ?? null) as WebeeNativeCost | null;
    const markupRows = (markupRes.data ?? []) as {
      label: string;
      markup_type: string;
      markup_value: number;
    }[];
    const markupRow = markupRows[0] ?? null;
    if (!markupRow) warnings.push("No active markup configured — margin cannot be calculated.");

    if (!blended) {
      warnings.push("No current blended rate row — calls without a recorded provider cost $0.");
    }
    if (!rates.some((r) => r.provider_category === "llm")) {
      warnings.push(
        "No LLM rates seeded — every call falls back to the flat GPT-4.1 figure, which overstates Cerebras by roughly 5x.",
      );
    }

    const perMin = calcWebeeNativeCostPerMin({ native: blended, avgCallMinutes: 3 });

    const recent: SpendCallRow[] = [];
    const live: LiveCall[] = [];
    const byDayMap = new Map<string, SpendDay>();
    const mix = new Map<
      string,
      { kind: "stt" | "tts" | "llm"; provider: string; calls: number; costUsd: number }
    >();
    let recorded = 0;
    let totalMinutes = 0;
    let totalCost = 0;

    for (const c of calls) {
      const seconds = Number(c.duration_seconds) || 0;
      const minutes = seconds / 60;

      // In progress: started, never ended. Costed at the blended rate because the providers it
      // actually used are only written at call end.
      if (!c.ended_at && c.started_at) {
        const elapsed = Math.max(
          0,
          Math.round((Date.now() - new Date(c.started_at).getTime()) / 1000),
        );
        if (elapsed < LIVE_MAX_ELAPSED_SECONDS) {
          live.push({
            id: String(c.id),
            agentName: c.agent_name ?? null,
            startedAt: c.started_at ?? null,
            elapsedSeconds: elapsed,
            estCostUsd: round((perMin.engineTotal * elapsed) / 60, 5),
          });
          continue;
        }
      }

      const voice = calcVoiceProviderCostBreakdown({
        rates,
        durationMinutes: minutes,
        sttProvider: c.stt_provider ?? null,
        ttsProvider: c.tts_provider ?? null,
        llmProvider: c.llm_provider ?? null,
        callType: c.to_number === "web:test" ? "web_call" : "phone_call",
        direction: c.call_type === "inbound" ? "inbound" : "outbound",
      });

      // Same precedence as the builder's Cost tab: a real provider rate wins, the blended figure
      // is the fallback. A provider-specific $0 would understate, not merely lack detail.
      const sttUsd =
        voice.sttProvider && !voice.sttRateMissing ? voice.sttUsd : perMin.stt * minutes;
      const ttsUsd =
        voice.ttsProvider && !voice.ttsRateMissing ? voice.ttsUsd : perMin.tts * minutes;
      const llmUsd =
        voice.llmProvider && !voice.llmRateMissing ? voice.llmUsd : perMin.llm * minutes;
      const overhead = (perMin.router + perMin.analysis + perMin.concurrency) * minutes;
      const totalUsd =
        sttUsd + ttsUsd + llmUsd + overhead + (voice.telephonyIncludedInTotal ? voice.telephonyUsd : 0);

      const estimated = !c.stt_provider || !c.tts_provider || !c.llm_provider;
      if (!estimated) recorded += 1;

      totalMinutes += minutes;
      totalCost += totalUsd;

      const day = String(c.created_at ?? "").slice(0, 10);
      const d = byDayMap.get(day) ?? { day, calls: 0, minutes: 0, costUsd: 0 };
      d.calls += 1;
      d.minutes += minutes;
      d.costUsd += totalUsd;
      byDayMap.set(day, d);

      for (const [kind, provider, usd] of [
        ["stt", c.stt_provider, sttUsd],
        ["tts", c.tts_provider, ttsUsd],
        ["llm", c.llm_provider, llmUsd],
      ] as const) {
        if (!provider) continue;
        const key = `${kind}|${provider}`;
        const m = mix.get(key) ?? { kind, provider: String(provider), calls: 0, costUsd: 0 };
        m.calls += 1;
        m.costUsd += usd;
        mix.set(key, m);
      }

      if (recent.length < data.limit) {
        recent.push({
          id: String(c.id),
          startedAt: c.started_at ?? c.created_at ?? null,
          agentName: c.agent_name ?? null,
          minutes: round(minutes, 2),
          sttProvider: c.stt_provider ?? null,
          ttsProvider: c.tts_provider ?? null,
          llmProvider: c.llm_provider ?? null,
          sttUsd: round(sttUsd, 5),
          ttsUsd: round(ttsUsd, 5),
          llmUsd: round(llmUsd, 5),
          telephonyUsd: round(voice.telephonyUsd, 5),
          totalUsd: round(totalUsd, 5),
          estimated,
          isTestCall: !!c.is_test_call,
        });
      }
    }

    // Margin uses the configured markup so this agrees with the cost-engine page rather than
    // inventing a second definition of "selling price".
    const pct = markupRow?.markup_type === "percentage" ? Number(markupRow.markup_value) || 0 : 0;
    const selling =
      markupRow?.markup_type === "percentage"
        ? totalCost * (1 + pct / 100)
        : totalCost + (Number(markupRow?.markup_value) || 0);
    const profit = selling - totalCost;

    return {
      rangeDays: data.days,
      totals: {
        calls: calls.length,
        minutes: round(totalMinutes, 1),
        costUsd: round(totalCost, 4),
        avgCostPerMin: totalMinutes > 0 ? round(totalCost / totalMinutes, 5) : 0,
        sellingUsd: round(selling, 4),
        profitUsd: round(profit, 4),
        marginPct: selling > 0 ? round((profit / selling) * 100, 1) : 0,
      },
      markup: markupRow
        ? {
            label: markupRow.label,
            type: markupRow.markup_type,
            value: Number(markupRow.markup_value),
          }
        : null,
      byDay: [...byDayMap.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((d) => ({ ...d, minutes: round(d.minutes, 1), costUsd: round(d.costUsd, 4) })),
      recent,
      live: live.sort((a, b) => b.elapsedSeconds - a.elapsedSeconds),
      providerMix: [...mix.values()]
        .map((m) => ({ ...m, costUsd: round(m.costUsd, 4) }))
        .sort((a, b) => b.costUsd - a.costUsd),
      providerCoverage: { recorded, total: calls.length },
      warnings,
    };
  });
