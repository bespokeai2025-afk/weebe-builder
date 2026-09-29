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

export interface TestCallCost {
  callId: string;
  costCents: number | null;
  durationSeconds: number | null;
  /** Only set for a webee_native call, when current rates are configured. */
  breakdown: {
    ratesAsOf: string;
    /** Each component's share of this call's actual duration, in USD cents. */
    ttsCents: number;
    sttCents: number;
    llmCents: number;
    routerCents: number;
    analysisCents: number;
    concurrencyCents: number;
    totalCents: number;
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
        .select("cost_cents, duration_seconds")
        .eq("retell_call_id", data.callId)
        .maybeSingle(),
      sb.from("call_turns").select("engine").eq("call_id", data.callId).limit(1),
    ]);

    const durationSeconds = (call?.duration_seconds as number | null) ?? null;
    const isNative = ((turns ?? [])[0] as { engine?: string } | undefined)?.engine === "webee_native";

    let breakdown: TestCallCost["breakdown"] = null;
    if (isNative && durationSeconds != null && durationSeconds > 0) {
      const { data: rates } = await sb
        .from("cost_engine_webee_native")
        .select("*")
        .eq("is_current", true)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (rates) {
        const minutes = durationSeconds / 60;
        const perMin = calcWebeeNativeCostPerMin({
          native: rates as WebeeNativeCost,
          avgCallMinutes: minutes,
        });
        const toCents = (usdPerMin: number) => Number((usdPerMin * minutes * 100).toFixed(4));
        breakdown = {
          ratesAsOf: rates.updated_at as string,
          ttsCents: toCents(perMin.tts),
          sttCents: toCents(perMin.stt),
          llmCents: toCents(perMin.llm),
          routerCents: toCents(perMin.router),
          analysisCents: toCents(perMin.analysis),
          concurrencyCents: toCents(perMin.concurrency),
          totalCents: toCents(perMin.engineTotal),
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
