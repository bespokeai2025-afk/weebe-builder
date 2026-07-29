// ── AI usage dashboard + billing diagnostics — admin-only server fns ─────────
// Powers /admin/ai-usage: registry status, usage/cost aggregations from the
// ai_usage_ledger, and a controlled billing diagnostic that makes ONE real
// /v1/responses call and records exactly which key + model served it.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";

// ── Registry + availability status ────────────────────────────────────────────

export const getModelRegistryStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const { DEFAULT_ROLE_ASSIGNMENTS, OPENAI_FALLBACK_CHAIN } = await import("@/lib/ai/model-registry.shared");
    const { resolveModelForRole, checkModelAvailability } = await import("@/lib/ai/model-registry.server");

    const roles = Object.keys(DEFAULT_ROLE_ASSIGNMENTS) as Array<keyof typeof DEFAULT_ROLE_ASSIGNMENTS>;
    const availability = await checkModelAvailability();

    const assignments = roles.map((role) => {
      const def = DEFAULT_ROLE_ASSIGNMENTS[role];
      const active = resolveModelForRole(role);
      const avail = availability.find((a) => a.role === role);
      return {
        role,
        provider: active.provider,
        defaultModel: def.model,
        activeModel: active.model,
        overridden: active.model !== def.model,
        envVar: def.envVar,
        reasoningEffort: active.reasoningEffort,
        friendlyLabel: active.friendlyLabel,
        available: avail?.available ?? false,
        availabilityError: avail?.error ?? null,
        checkedAt: avail?.checkedAt ?? null,
      };
    });

    return { assignments, fallbackChain: OPENAI_FALLBACK_CHAIN };
  });

// ── Usage dashboard aggregations ──────────────────────────────────────────────

export const getAiUsageDashboard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .validator((input: unknown) =>
    z.object({ days: z.number().int().min(1).max(90).default(30) }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const since = new Date(Date.now() - data.days * 86400000).toISOString();

    // Page past PostgREST's 1000-row cap so totals are honest.
    const rows: any[] = [];
    for (let page = 0; page < 30; page++) {
      const { data: chunk, error } = await sb
        .from("ai_usage_ledger")
        .select("created_at, workspace_id, department, feature, provider, requested_model, returned_model, input_tokens, cached_input_tokens, output_tokens, reasoning_tokens, video_seconds, latency_ms, status, fallback_used, fallback_from, error_message, estimated_cost_usd")
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .range(page * 1000, page * 1000 + 999);
      if (error) throw new Error(`ai_usage_ledger read failed: ${error.message}`);
      rows.push(...(chunk ?? []));
      if ((chunk ?? []).length < 1000) break;
    }

    const num = (v: any) => (typeof v === "number" ? v : Number(v) || 0);
    const agg = (keyOf: (r: any) => string) => {
      const m = new Map<string, { requests: number; inputTokens: number; outputTokens: number; costUsd: number; failures: number; fallbacks: number }>();
      for (const r of rows) {
        const k = keyOf(r) || "(unknown)";
        const e = m.get(k) ?? { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, failures: 0, fallbacks: 0 };
        e.requests += 1;
        e.inputTokens += num(r.input_tokens);
        e.outputTokens += num(r.output_tokens) + num(r.reasoning_tokens);
        e.costUsd += num(r.estimated_cost_usd);
        if (r.status === "failed") e.failures += 1;
        if (r.fallback_used) e.fallbacks += 1;
        m.set(k, e);
      }
      return Array.from(m.entries())
        .map(([key, v]) => ({ key, ...v, costUsd: Math.round(v.costUsd * 10000) / 10000 }))
        .sort((a, b) => b.costUsd - a.costUsd);
    };

    // Daily cost series
    const dayMap = new Map<string, number>();
    for (const r of rows) {
      const day = String(r.created_at).slice(0, 10);
      dayMap.set(day, (dayMap.get(day) ?? 0) + num(r.estimated_cost_usd));
    }
    const daily = Array.from(dayMap.entries())
      .map(([day, costUsd]) => ({ day, costUsd: Math.round(costUsd * 10000) / 10000 }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const totals = {
      requests: rows.length,
      failures: rows.filter((r) => r.status === "failed").length,
      fallbacks: rows.filter((r) => r.fallback_used).length,
      costUsd: Math.round(rows.reduce((s, r) => s + num(r.estimated_cost_usd), 0) * 10000) / 10000,
      inputTokens: rows.reduce((s, r) => s + num(r.input_tokens), 0),
      outputTokens: rows.reduce((s, r) => s + num(r.output_tokens) + num(r.reasoning_tokens), 0),
      videoSeconds: Math.round(rows.reduce((s, r) => s + num(r.video_seconds), 0) * 100) / 100,
    };

    // First-class "spend today" / "spend this month" — computed with dedicated
    // paged reads so they are correct regardless of the selected window.
    const sumCostSince = async (sinceIso: string) => {
      let total = 0;
      for (let page = 0; page < 60; page++) {
        const { data: chunk, error } = await sb
          .from("ai_usage_ledger")
          .select("estimated_cost_usd")
          .gte("created_at", sinceIso)
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(`ai_usage_ledger spend read failed: ${error.message}`);
        for (const r of chunk ?? []) total += num(r.estimated_cost_usd);
        if ((chunk ?? []).length < 1000) break;
      }
      return Math.round(total * 10000) / 10000;
    };
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [spendTodayUsd, spendThisMonthUsd] = await Promise.all([
      sumCostSince(todayStart),
      sumCostSince(monthStart),
    ]);

    return {
      days: data.days,
      totals,
      spendTodayUsd,
      spendThisMonthUsd,
      byModel: agg((r) => r.returned_model || r.requested_model),
      byDepartment: agg((r) => r.department),
      byWorkspace: agg((r) => r.workspace_id ?? "(platform)").slice(0, 25),
      byFeature: agg((r) => `${r.department}/${r.feature}`).slice(0, 25),
      daily,
      recentFailures: rows
        .filter((r) => r.status === "failed")
        .slice(0, 20)
        .map((r) => ({
          createdAt: r.created_at, department: r.department, feature: r.feature,
          model: r.requested_model, error: r.error_message,
        })),
    };
  });

// ── Billing diagnostic — one controlled real request ─────────────────────────

export const runAiBillingDiagnostic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const keyFingerprint = `sk-...${apiKey.slice(-4)}`;

    const { resolveModelForRole } = await import("@/lib/ai/model-registry.server");
    const { recordAiUsage } = await import("@/lib/ai/usage-ledger.server");
    const { estimateAiCostUsd } = await import("@/lib/ai/model-registry.shared");
    const assignment = resolveModelForRole("hivemind_background");

    const started = Date.now();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: assignment.model,
        input: "Reply with exactly: DIAGNOSTIC OK",
        max_output_tokens: 16,
      }),
    });
    const requestIdHeader = res.headers.get("x-request-id");
    const latencyMs = Date.now() - started;

    if (!res.ok) {
      const err = (await res.text().catch(() => "")).slice(0, 300);
      await recordAiUsage({
        department: "platform", feature: "billing_diagnostic", provider: "openai",
        requestedModel: assignment.model, endpoint: "/v1/responses",
        requestId: requestIdHeader, latencyMs, status: "failed",
        errorMessage: `OpenAI ${res.status}: ${err}`,
        routing: { keyFingerprint },
      });
      return {
        ok: false as const, keyFingerprint, requestedModel: assignment.model,
        returnedModel: null, requestId: requestIdHeader, latencyMs,
        error: `OpenAI ${res.status}: ${err}`,
      };
    }

    const json = (await res.json()) as any;
    const usage = json.usage ?? {};
    const returnedModel = String(json.model ?? assignment.model);
    await recordAiUsage({
      department: "platform", feature: "billing_diagnostic", provider: "openai",
      requestedModel: assignment.model, returnedModel,
      endpoint: "/v1/responses", requestId: json.id ?? requestIdHeader,
      inputTokens: usage.input_tokens ?? 0,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      latencyMs, status: "diagnostic",
      routing: { keyFingerprint },
    });

    return {
      ok: true as const,
      keyFingerprint,
      requestedModel: assignment.model,
      returnedModel,
      requestId: (json.id as string) ?? requestIdHeader,
      latencyMs,
      inputTokens: usage.input_tokens ?? 0,
      cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      estimatedCostUsd: estimateAiCostUsd({
        model: returnedModel,
        inputTokens: usage.input_tokens ?? 0,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        reasoningTokens: usage.output_tokens_details?.reasoning_tokens ?? 0,
      }),
      error: null,
    };
  });
