import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LlmCost {
  id: string;
  provider: string;
  model: string;
  input_token_cost: number;
  output_token_cost: number;
  audio_input_cost: number;
  audio_output_cost: number;
  cached_token_cost: number;
  is_current: boolean;
  notes: string | null;
  created_at: string;
}

export interface VoiceCost {
  id: string;
  provider: string;
  voice_id: string;
  voice_name: string;
  cost_per_character: number;
  cost_per_minute: number;
  cost_per_request: number;
  is_current: boolean;
  notes: string | null;
  created_at: string;
}

export interface TelephonyCost {
  id: string;
  provider: string;
  country: string;
  inbound_cost_per_min: number;
  outbound_cost_per_min: number;
  recording_cost_per_min: number;
  number_rental_monthly: number;
  is_current: boolean;
  notes: string | null;
  created_at: string;
}

export interface KnowledgeCost {
  id: string;
  embedding_cost_per_1k: number;
  vector_storage_per_gb_month: number;
  retrieval_cost_per_query: number;
  storage_per_gb_month: number;
  is_current: boolean;
  notes: string | null;
}

export interface ToolsCost {
  id: string;
  webhook_cost_per_call: number;
  api_cost_per_call: number;
  crm_cost_per_month: number;
  calendar_cost_per_month: number;
  is_current: boolean;
  notes: string | null;
}

export interface InfrastructureCost {
  id: string;
  server_cost: number;
  database_cost: number;
  storage_cost: number;
  bandwidth_cost: number;
  allocation_type: "monthly" | "per_minute";
  estimated_monthly_minutes: number;
  is_current: boolean;
  notes: string | null;
}

export interface RetellCost {
  id: string;
  subscription_cost_monthly: number;
  minute_cost: number;
  number_cost_monthly: number;
  voice_cost_per_min: number;
  transfer_cost_per_min: number;
  is_current: boolean;
  notes: string | null;
}

export interface Markup {
  id: string;
  label: string;
  markup_type: "fixed" | "percentage";
  markup_value: number;
  is_active: boolean;
  notes: string | null;
}

export interface CustomerPlan {
  id: string;
  plan_name: string;
  description: string | null;
  included_minutes: number;
  price_per_month: number;
  price_per_minute: number;
  is_active: boolean;
  sort_order: number;
}

export interface DevRole {
  id: string;
  role_name: string;
  rate_per_hour: number;
  hours_per_week: number;
  notes: string | null;
  sort_order: number;
  created_at: string;
}

export interface TeamMember {
  role_id: string;
  role_name: string;
  rate_per_hour: number;
  hours_per_week: number;
  count: number;
  weeks: number;
}

export interface AddonCharge {
  label: string;
  amount: number;
}

export interface ClientEstimate {
  id: string;
  client_name: string;
  client_email: string | null;
  plan_id: string | null;
  project_weeks: number;
  team_config: TeamMember[];
  monthly_addon_charges: AddonCharge[];
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostEngineData {
  llm: LlmCost[];
  voice: VoiceCost[];
  telephony: TelephonyCost[];
  knowledge: KnowledgeCost | null;
  tools: ToolsCost | null;
  infrastructure: InfrastructureCost | null;
  retell: RetellCost | null;
  markup: Markup | null;
  plans: CustomerPlan[];
  dev_roles: DevRole[];
}

export interface CostAnalytics {
  total_calls: number;
  total_minutes: number;
  total_cost_cents: number;
  total_revenue_cents: number;
  total_profit_cents: number;
  avg_margin_pct: number;
  by_provider: Array<{ provider: string; calls: number; cost_cents: number; revenue_cents: number; profit_cents: number }>;
  by_workspace: Array<{ workspace_id: string; calls: number; cost_cents: number; profit_cents: number; margin_pct: number }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function n(v: unknown): number {
  return Number(v) || 0;
}

// ── Read ──────────────────────────────────────────────────────────────────────

export const getCostEngine = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async (): Promise<CostEngineData & { tablesReady: boolean }> => {
    // Probe whether tables exist yet
    const probe = await supabaseAdmin.from("cost_engine_llm" as any).select("id").limit(1);
    if (probe.error?.code === "42P01") {
      // Tables not yet created — migration pending
      return {
        tablesReady: false,
        llm: [], voice: [], telephony: [],
        knowledge: null, tools: null, infrastructure: null,
        retell: null, markup: null, plans: [], dev_roles: [],
      };
    }

    const [llmR, voiceR, telR, knR, toolR, infraR, retR, mkR, planR, roleR] =
      await Promise.all([
        supabaseAdmin.from("cost_engine_llm" as any).select("*").eq("is_current", true).order("provider").order("model"),
        supabaseAdmin.from("cost_engine_voice" as any).select("*").eq("is_current", true).order("provider").order("voice_name"),
        supabaseAdmin.from("cost_engine_telephony" as any).select("*").eq("is_current", true).order("provider").order("country"),
        supabaseAdmin.from("cost_engine_knowledge" as any).select("*").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("cost_engine_tools" as any).select("*").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("cost_engine_infrastructure" as any).select("*").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("cost_engine_retell" as any).select("*").eq("is_current", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("cost_engine_markup" as any).select("*").eq("is_active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabaseAdmin.from("cost_engine_customer_plans" as any).select("*").eq("is_active", true).order("sort_order"),
        supabaseAdmin.from("cost_engine_dev_roles" as any).select("*").order("sort_order"),
      ]);

    return {
      tablesReady: true,
      llm: (llmR.data ?? []) as LlmCost[],
      voice: (voiceR.data ?? []) as VoiceCost[],
      telephony: (telR.data ?? []) as TelephonyCost[],
      knowledge: knR.data as KnowledgeCost | null,
      tools: toolR.data as ToolsCost | null,
      infrastructure: infraR.data as InfrastructureCost | null,
      retell: retR.data as RetellCost | null,
      markup: mkR.data as Markup | null,
      plans: (planR.data ?? []) as CustomerPlan[],
      dev_roles: (roleR.data ?? []) as DevRole[],
    };
  });

export const getCostAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async (): Promise<CostAnalytics> => {
    const { data } = await supabaseAdmin
      .from("call_profitability" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(5000);

    const rows = data ?? [];
    const total_calls = rows.length;
    const total_minutes = rows.reduce((s, r) => s + Math.ceil(n(r.duration_seconds) / 60), 0);
    const total_cost_cents = rows.reduce((s, r) => s + n(r.total_cost_cents), 0);
    const total_revenue_cents = rows.reduce((s, r) => s + n(r.selling_price_cents), 0);
    const total_profit_cents = rows.reduce((s, r) => s + n(r.profit_cents), 0);
    const avg_margin_pct = total_revenue_cents > 0 ? (total_profit_cents / total_revenue_cents) * 100 : 0;

    const providerMap = new Map<string, { calls: number; cost_cents: number; revenue_cents: number; profit_cents: number }>();
    const wsMap = new Map<string, { calls: number; cost_cents: number; revenue_cents: number; profit_cents: number }>();

    for (const r of rows) {
      const p = r.provider ?? "unknown";
      const pm = providerMap.get(p) ?? { calls: 0, cost_cents: 0, revenue_cents: 0, profit_cents: 0 };
      pm.calls++;
      pm.cost_cents += n(r.total_cost_cents);
      pm.revenue_cents += n(r.selling_price_cents);
      pm.profit_cents += n(r.profit_cents);
      providerMap.set(p, pm);

      if (r.workspace_id) {
        const wm = wsMap.get(r.workspace_id) ?? { calls: 0, cost_cents: 0, revenue_cents: 0, profit_cents: 0 };
        wm.calls++;
        wm.cost_cents += n(r.total_cost_cents);
        wm.revenue_cents += n(r.selling_price_cents);
        wm.profit_cents += n(r.profit_cents);
        wsMap.set(r.workspace_id, wm);
      }
    }

    return {
      total_calls,
      total_minutes,
      total_cost_cents,
      total_revenue_cents,
      total_profit_cents,
      avg_margin_pct,
      by_provider: Array.from(providerMap.entries()).map(([provider, v]) => ({ provider, ...v })),
      by_workspace: Array.from(wsMap.entries()).map(([workspace_id, v]) => ({
        workspace_id,
        ...v,
        margin_pct: v.revenue_cents > 0 ? (v.profit_cents / v.revenue_cents) * 100 : 0,
      })).sort((a, b) => b.profit_cents - a.profit_cents),
    };
  });

// ── LLM ───────────────────────────────────────────────────────────────────────

const LlmInput = z.object({
  id: z.string().optional(),
  provider: z.string().min(1),
  model: z.string().min(1),
  input_token_cost: z.number(),
  output_token_cost: z.number(),
  audio_input_cost: z.number(),
  audio_output_cost: z.number(),
  cached_token_cost: z.number(),
  notes: z.string().optional(),
});

export const saveLlmCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof LlmInput>) => LlmInput.parse(i))
  .handler(async ({ data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_llm" as any).update({
        provider: data.provider, model: data.model,
        input_token_cost: data.input_token_cost, output_token_cost: data.output_token_cost,
        audio_input_cost: data.audio_input_cost, audio_output_cost: data.audio_output_cost,
        cached_token_cost: data.cached_token_cost, notes: data.notes ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_llm" as any).insert({
        provider: data.provider, model: data.model,
        input_token_cost: data.input_token_cost, output_token_cost: data.output_token_cost,
        audio_input_cost: data.audio_input_cost, audio_output_cost: data.audio_output_cost,
        cached_token_cost: data.cached_token_cost, notes: data.notes ?? null,
        is_current: true,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteLlmCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_llm" as any).update({ is_current: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Voice ─────────────────────────────────────────────────────────────────────

const VoiceInput = z.object({
  id: z.string().optional(),
  provider: z.string().min(1),
  voice_id: z.string().min(1),
  voice_name: z.string().min(1),
  cost_per_character: z.number(),
  cost_per_minute: z.number(),
  cost_per_request: z.number(),
  notes: z.string().optional(),
});

export const saveVoiceCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof VoiceInput>) => VoiceInput.parse(i))
  .handler(async ({ data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_voice" as any).update({
        provider: data.provider, voice_id: data.voice_id, voice_name: data.voice_name,
        cost_per_character: data.cost_per_character, cost_per_minute: data.cost_per_minute,
        cost_per_request: data.cost_per_request, notes: data.notes ?? null,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_voice" as any).insert({
        provider: data.provider, voice_id: data.voice_id, voice_name: data.voice_name,
        cost_per_character: data.cost_per_character, cost_per_minute: data.cost_per_minute,
        cost_per_request: data.cost_per_request, notes: data.notes ?? null, is_current: true,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteVoiceCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_voice" as any).update({ is_current: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Telephony ─────────────────────────────────────────────────────────────────

const TelInput = z.object({
  id: z.string().optional(),
  provider: z.string().min(1),
  country: z.string().min(1),
  inbound_cost_per_min: z.number(),
  outbound_cost_per_min: z.number(),
  recording_cost_per_min: z.number(),
  number_rental_monthly: z.number(),
  notes: z.string().optional(),
});

export const saveTelephonyCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof TelInput>) => TelInput.parse(i))
  .handler(async ({ data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_telephony" as any).update({
        provider: data.provider, country: data.country,
        inbound_cost_per_min: data.inbound_cost_per_min, outbound_cost_per_min: data.outbound_cost_per_min,
        recording_cost_per_min: data.recording_cost_per_min, number_rental_monthly: data.number_rental_monthly,
        notes: data.notes ?? null, updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_telephony" as any).insert({
        provider: data.provider, country: data.country,
        inbound_cost_per_min: data.inbound_cost_per_min, outbound_cost_per_min: data.outbound_cost_per_min,
        recording_cost_per_min: data.recording_cost_per_min, number_rental_monthly: data.number_rental_monthly,
        notes: data.notes ?? null, is_current: true,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const deleteTelephonyCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_telephony" as any).update({ is_current: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Singleton costs ───────────────────────────────────────────────────────────

async function upsertSingleton(table: string, fields: Record<string, unknown>) {
  await supabaseAdmin.from(table as any).update({ is_current: false }).eq("is_current", true);
  const { error } = await supabaseAdmin.from(table as any).insert({ ...fields, is_current: true });
  if (error) throw new Error(error.message);
}

const KnowledgeInput = z.object({
  embedding_cost_per_1k: z.number(),
  vector_storage_per_gb_month: z.number(),
  retrieval_cost_per_query: z.number(),
  storage_per_gb_month: z.number(),
  notes: z.string().optional(),
});

export const saveKnowledgeCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof KnowledgeInput>) => KnowledgeInput.parse(i))
  .handler(async ({ data }) => {
    await upsertSingleton("cost_engine_knowledge", data);
    return { ok: true };
  });

const ToolsInput = z.object({
  webhook_cost_per_call: z.number(),
  api_cost_per_call: z.number(),
  crm_cost_per_month: z.number(),
  calendar_cost_per_month: z.number(),
  notes: z.string().optional(),
});

export const saveToolsCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof ToolsInput>) => ToolsInput.parse(i))
  .handler(async ({ data }) => {
    await upsertSingleton("cost_engine_tools", data);
    return { ok: true };
  });

const InfraInput = z.object({
  server_cost: z.number(),
  database_cost: z.number(),
  storage_cost: z.number(),
  bandwidth_cost: z.number(),
  allocation_type: z.string(),
  estimated_monthly_minutes: z.number(),
  notes: z.string().optional(),
});

export const saveInfrastructureCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof InfraInput>) => InfraInput.parse(i))
  .handler(async ({ data }) => {
    await upsertSingleton("cost_engine_infrastructure", data);
    return { ok: true };
  });

const RetellInput = z.object({
  subscription_cost_monthly: z.number(),
  minute_cost: z.number(),
  number_cost_monthly: z.number(),
  voice_cost_per_min: z.number(),
  transfer_cost_per_min: z.number(),
  notes: z.string().optional(),
});

export const saveRetellCost = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof RetellInput>) => RetellInput.parse(i))
  .handler(async ({ data }) => {
    await upsertSingleton("cost_engine_retell", data);
    return { ok: true };
  });

// ── Markup ────────────────────────────────────────────────────────────────────

const MarkupInput = z.object({
  markup_type: z.enum(["fixed", "percentage"]),
  markup_value: z.number(),
  label: z.string().optional(),
  notes: z.string().optional(),
});

export const saveMarkup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof MarkupInput>) => MarkupInput.parse(i))
  .handler(async ({ data }) => {
    await supabaseAdmin.from("cost_engine_markup" as any).update({ is_active: false }).eq("is_active", true);
    const { error } = await supabaseAdmin.from("cost_engine_markup" as any).insert({
      label: data.label ?? "Default",
      markup_type: data.markup_type,
      markup_value: data.markup_value,
      notes: data.notes ?? null,
      is_active: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Customer plans ─────────────────────────────────────────────────────────────

const PlanInput = z.object({
  id: z.string().optional(),
  plan_name: z.string().min(1),
  description: z.string().optional(),
  included_minutes: z.number().min(0),
  price_per_month: z.number().min(0),
  price_per_minute: z.number().min(0),
  sort_order: z.number().optional(),
});

export const savePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof PlanInput>) => PlanInput.parse(i))
  .handler(async ({ data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_customer_plans" as any).update({
        plan_name: data.plan_name, description: data.description ?? null,
        included_minutes: data.included_minutes, price_per_month: data.price_per_month,
        price_per_minute: data.price_per_minute, sort_order: data.sort_order ?? 0,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_customer_plans" as any).insert({
        plan_name: data.plan_name, description: data.description ?? null,
        included_minutes: data.included_minutes, price_per_month: data.price_per_month,
        price_per_minute: data.price_per_minute, sort_order: data.sort_order ?? 0,
        is_active: true,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deletePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof DeleteInput>) => DeleteInput.parse(i))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_customer_plans" as any).update({ is_active: false }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Dev Roles ────────────────────────────────────────────────────────────────

const DevRoleInput = z.object({
  id: z.string().optional(),
  role_name: z.string().min(1),
  rate_per_hour: z.number().min(0),
  hours_per_week: z.number().int().min(1).max(168),
  notes: z.string().optional(),
  sort_order: z.number().optional(),
});

export const saveDevRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof DevRoleInput>) => DevRoleInput.parse(i))
  .handler(async ({ data }) => {
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_dev_roles" as any).update({
        role_name: data.role_name, rate_per_hour: data.rate_per_hour,
        hours_per_week: data.hours_per_week, notes: data.notes ?? null,
        sort_order: data.sort_order ?? 0,
      }).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_dev_roles" as any).insert({
        role_name: data.role_name, rate_per_hour: data.rate_per_hour,
        hours_per_week: data.hours_per_week, notes: data.notes ?? null,
        sort_order: data.sort_order ?? 0,
      });
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const DeleteRoleInput = z.object({ id: z.string().uuid() });

export const deleteDevRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof DeleteRoleInput>) => DeleteRoleInput.parse(i))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_dev_roles" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Client Estimates ─────────────────────────────────────────────────────────

export const getClientEstimates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async (): Promise<ClientEstimate[]> => {
    const { data, error } = await supabaseAdmin
      .from("cost_engine_client_estimates" as any)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ClientEstimate[];
  });

const EstimateInput = z.object({
  id: z.string().optional(),
  client_name: z.string().min(1),
  client_email: z.string().optional(),
  plan_id: z.string().optional(),
  project_weeks: z.number().int().min(1),
  team_config: z.array(z.object({
    role_id: z.string(),
    role_name: z.string(),
    rate_per_hour: z.number(),
    hours_per_week: z.number(),
    count: z.number().int().min(1),
    weeks: z.number().int().min(1),
  })),
  monthly_addon_charges: z.array(z.object({
    label: z.string(),
    amount: z.number().min(0),
  })),
  notes: z.string().optional(),
});

export const saveClientEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof EstimateInput>) => EstimateInput.parse(i))
  .handler(async ({ data }) => {
    const payload = {
      client_name: data.client_name,
      client_email: data.client_email ?? null,
      plan_id: data.plan_id || null,
      project_weeks: data.project_weeks,
      team_config: data.team_config,
      monthly_addon_charges: data.monthly_addon_charges,
      notes: data.notes ?? null,
      updated_at: new Date().toISOString(),
    };
    if (data.id) {
      const { error } = await supabaseAdmin.from("cost_engine_client_estimates" as any).update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin.from("cost_engine_client_estimates" as any).insert(payload);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

const DeleteEstimateInput = z.object({ id: z.string().uuid() });

export const deleteClientEstimate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .inputValidator((i: z.infer<typeof DeleteEstimateInput>) => DeleteEstimateInput.parse(i))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("cost_engine_client_estimates" as any).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Calculation helpers (used client-side too, so exported as pure functions) ─

export function calcInfraCostPerMin(infra: InfrastructureCost | null): number {
  if (!infra) return 0;
  const total = n(infra.server_cost) + n(infra.database_cost) + n(infra.storage_cost) + n(infra.bandwidth_cost);
  if (infra.allocation_type === "per_minute") return total;
  const mins = n(infra.estimated_monthly_minutes) || 1;
  return total / mins;
}

export function calcHyperstreamCostPerMin(opts: {
  llm: LlmCost | null;
  voice: VoiceCost | null;
  telephony: TelephonyCost | null;
  knowledge: KnowledgeCost | null;
  tools: ToolsCost | null;
  infrastructure: InfrastructureCost | null;
}): { total: number; breakdown: Record<string, number> } {
  const llm = n(opts.llm?.audio_input_cost) + n(opts.llm?.audio_output_cost);
  const voice = n(opts.voice?.cost_per_minute);
  const telephony = n(opts.telephony?.outbound_cost_per_min);
  const knowledge = n(opts.knowledge?.retrieval_cost_per_query) * 2; // ~2 retrievals/min
  const tools = n(opts.tools?.webhook_cost_per_call) * 1; // ~1 call/min
  const infra = calcInfraCostPerMin(opts.infrastructure);
  const total = llm + voice + telephony + knowledge + tools + infra;
  return { total, breakdown: { llm, voice, telephony, knowledge, tools, infra } };
}

export function calcRetellCostPerMin(retell: RetellCost | null): number {
  return n(retell?.minute_cost) + n(retell?.voice_cost_per_min);
}

export interface RetellCostBreakdown {
  platform: number;   // Retell per-minute agent fee
  llm: number;        // custom LLM (audio in + out, or token cost)
  voice: number;      // external voice provider per-min
  telephony: number;  // inbound/outbound carrier cost
  number: number;     // phone number rental amortised per-min
  subscription: number; // monthly platform fee amortised per-min
  total: number;
}

export function calcRetellFullCostPerMin(opts: {
  retell: RetellCost | null;
  llm: LlmCost | null;
  voice: VoiceCost | null;
  telephony: TelephonyCost | null;
  estimatedMonthlyMinutes: number;
  callDirection: "inbound" | "outbound";
}): RetellCostBreakdown {
  const mins = opts.estimatedMonthlyMinutes || 1;
  const platform = n(opts.retell?.minute_cost);
  // LLM: prefer audio rates (realtime), fall back to token rates at ~150 tokens/min
  const llmAudio = n(opts.llm?.audio_input_cost) + n(opts.llm?.audio_output_cost);
  const llmToken = (n(opts.llm?.input_token_cost) + n(opts.llm?.output_token_cost)) * (150 / 1000);
  const llm = opts.llm ? (llmAudio > 0 ? llmAudio : llmToken) : 0;
  // Voice: use either the Retell bundled rate or an explicit voice row
  const voiceBundled = n(opts.retell?.voice_cost_per_min);
  const voice = opts.voice ? n(opts.voice.cost_per_minute) : voiceBundled;
  // Telephony: direction-aware
  const telephony = opts.telephony
    ? (opts.callDirection === "inbound"
        ? n(opts.telephony.inbound_cost_per_min)
        : n(opts.telephony.outbound_cost_per_min))
    : n(opts.retell?.transfer_cost_per_min);
  // Fixed costs amortised over monthly minutes
  const number = n(opts.retell?.number_cost_monthly) / mins;
  const subscription = n(opts.retell?.subscription_cost_monthly) / mins;
  const total = platform + llm + voice + telephony + number + subscription;
  return { platform, llm, voice, telephony, number, subscription, total };
}

export function applyMarkup(cost: number, markup: Markup | null): { selling: number; profit: number; margin: number } {
  if (!markup) return { selling: cost, profit: 0, margin: 0 };
  const selling =
    markup.markup_type === "percentage"
      ? cost * (1 + n(markup.markup_value) / 100)
      : cost + n(markup.markup_value);
  const profit = selling - cost;
  const margin = selling > 0 ? (profit / selling) * 100 : 0;
  return { selling, profit, margin };
}

// ── Provider Spend Rollup ─────────────────────────────────────────────────────
// Aggregates provider_usage across all workspaces so the admin cost dashboard
// can surface third-party API spend broken down by integration category.

export interface ProviderSpendRow {
  provider_category: string;
  provider_name: string;
  workspaces: number;
  total_requests: number;
  total_errors: number;
  total_cost_usd: number;
  total_duration_ms: number;
}

export const getProviderSpendRollup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async (): Promise<{
    rows: ProviderSpendRow[];
    grandTotalUsd: number;
    grandTotalRequests: number;
  }> => {
    try {
      const { data } = await supabaseAdmin
        .from("provider_usage" as any)
        .select("provider_category, provider_name, requests, errors, total_cost_usd, total_duration_ms, workspace_id");

      const rows = data ?? [];

      // Group by category + provider_name across all workspaces
      const map = new Map<string, ProviderSpendRow>();
      const wsTracker = new Map<string, Set<string>>();

      for (const r of rows) {
        const key = `${r.provider_category}:${r.provider_name}`;
        const existing = map.get(key) ?? {
          provider_category: r.provider_category,
          provider_name: r.provider_name,
          workspaces: 0,
          total_requests: 0,
          total_errors: 0,
          total_cost_usd: 0,
          total_duration_ms: 0,
        };
        existing.total_requests += n(r.requests);
        existing.total_errors += n(r.errors);
        existing.total_cost_usd += n(r.total_cost_usd);
        existing.total_duration_ms += n(r.total_duration_ms);
        map.set(key, existing);

        if (r.workspace_id) {
          if (!wsTracker.has(key)) wsTracker.set(key, new Set());
          wsTracker.get(key)!.add(r.workspace_id);
        }
      }

      for (const [key, row] of map.entries()) {
        row.workspaces = wsTracker.get(key)?.size ?? 0;
      }

      const result = Array.from(map.values()).sort((a, b) => b.total_cost_usd - a.total_cost_usd);
      const grandTotalUsd = result.reduce((s, r) => s + r.total_cost_usd, 0);
      const grandTotalRequests = result.reduce((s, r) => s + r.total_requests, 0);

      return { rows: result, grandTotalUsd, grandTotalRequests };
    } catch {
      return { rows: [], grandTotalUsd: 0, grandTotalRequests: 0 };
    }
  });

// ── Provider Cost Rate Overrides ───────────────────────────────────────────────
//
// These functions manage per-workspace cost-rate overrides stored in the
// `provider_cost_rates` table (migration 20260720000000_provider_cost_extension).
// They allow workspace admins to enter the actual unit cost they pay a provider
// so that the cost engine can calculate per-call profitability accurately.

export interface ProviderCostRate {
  id: string;
  workspace_id: string;
  provider_category: string;
  provider_name: string;
  unit_type: string;
  cost_per_unit_usd: number;
  notes: string | null;
  created_at: string;
}

/**
 * Fetch all provider cost-rate overrides for the calling workspace.
 */
export const getProviderCostRates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId: string = (context as any).workspaceId;
    if (!workspaceId) throw new Error("Workspace not found");
    const sb = supabaseAdmin as any;
    const { data, error } = await sb
      .from("provider_cost_rates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("provider_category")
      .order("provider_name");
    if (error) throw new Error(error.message);
    return (data ?? []) as ProviderCostRate[];
  });

const ProviderCostRateInput = z.object({
  provider_category: z.string().min(1),
  provider_name:     z.string().min(1),
  unit_type:         z.string().min(1),
  cost_per_unit_usd: z.number().min(0),
  notes:             z.string().optional(),
});

/** Inline admin guard reused by cost-rate mutations. */
async function requireCostRateAdmin(context: any): Promise<void> {
  const { data } = await (context.supabase as any)
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", context.workspaceId)
    .eq("user_id", context.userId)
    .maybeSingle();
  if (data?.role !== "owner" && data?.role !== "admin") {
    throw new Error("Forbidden: only workspace owners and admins can manage provider cost rates.");
  }
}

/**
 * Upsert a single provider cost-rate override for the calling workspace.
 * Uniqueness is on (workspace_id, provider_category, provider_name, unit_type).
 */
export const saveProviderCostRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof ProviderCostRateInput>) => ProviderCostRateInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId: string = (context as any).workspaceId;
    if (!workspaceId) throw new Error("Workspace not found");
    await requireCostRateAdmin(context);
    const sb = supabaseAdmin as any;
    const { error } = await sb.from("provider_cost_rates").upsert(
      {
        workspace_id:      workspaceId,
        provider_category: data.provider_category,
        provider_name:     data.provider_name,
        unit_type:         data.unit_type,
        cost_per_unit_usd: data.cost_per_unit_usd,
        notes:             data.notes ?? null,
      },
      { onConflict: "workspace_id,provider_category,provider_name,unit_type" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Delete a provider cost-rate override by its row ID.
 * Constrained to the calling workspace so cross-workspace deletion is impossible
 * even when using the admin client (which bypasses RLS).
 */
export const deleteProviderCostRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { id: string }) => i)
  .handler(async ({ data, context }) => {
    const workspaceId: string = (context as any).workspaceId;
    if (!workspaceId) throw new Error("Workspace not found");
    await requireCostRateAdmin(context);
    const sb = supabaseAdmin as any;
    // Delete ONLY if the row belongs to this workspace — prevents cross-workspace deletion.
    const { error } = await sb
      .from("provider_cost_rates")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
