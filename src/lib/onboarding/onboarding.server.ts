import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type OnboardingPath = "agent_builder" | "grow" | "both";
export type CrmChoice = "smart_dash" | "external" | "skip";

export interface OnboardingState {
  exists: boolean;
  path: OnboardingPath | null;
  completed: boolean;
  dismissed: boolean;
  business_dna_done: boolean;
  knowledge_uploaded: boolean;
  connections_done: boolean;
  first_agent_done: boolean;
  first_campaign_done: boolean;
  analysis_done: boolean;
  telephony_done: boolean;
  crm_choice: CrmChoice | null;
}

const EMPTY: OnboardingState = {
  exists: false,
  path: null,
  completed: false,
  dismissed: false,
  business_dna_done: false,
  knowledge_uploaded: false,
  connections_done: false,
  first_agent_done: false,
  first_campaign_done: false,
  analysis_done: false,
  telephony_done: false,
  crm_choice: null,
};

// ── Server Functions ──────────────────────────────────────────────────────────

export const getOnboardingState = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OnboardingState> => {
    const { workspaceId } = context;
    const sb = supabaseAdmin as any;

    const { data } = await sb
      .from("workspace_onboarding")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (!data) return { ...EMPTY, exists: false };

    return {
      exists: true,
      path: data.path ?? null,
      completed: data.completed ?? false,
      dismissed: data.dismissed ?? false,
      business_dna_done: data.business_dna_done ?? false,
      knowledge_uploaded: data.knowledge_uploaded ?? false,
      connections_done: data.connections_done ?? false,
      first_agent_done: data.first_agent_done ?? false,
      first_campaign_done: data.first_campaign_done ?? false,
      analysis_done: data.analysis_done ?? false,
      telephony_done: data.telephony_done ?? false,
      crm_choice: data.crm_choice ?? null,
    };
  });

// Only these columns may be set from the client.
const OnboardingStepPatchSchema = z
  .object({
    business_dna_done: z.boolean(),
    knowledge_uploaded: z.boolean(),
    connections_done: z.boolean(),
    first_agent_done: z.boolean(),
    first_campaign_done: z.boolean(),
    analysis_done: z.boolean(),
    telephony_done: z.boolean(),
    crm_choice: z.enum(["smart_dash", "external", "skip"]),
    completed: z.boolean(),
    dismissed: z.boolean(),
  })
  .partial()
  .strict();
type OnboardingStepPatch = z.infer<typeof OnboardingStepPatchSchema>;

const OnboardingDnaFormSchema = z.object({
  companyName: z.string().max(300),
  industry: z.string().max(300),
  website: z.string().max(500),
  locations: z.string().max(1000),
  targetCustomers: z.string().max(2000),
  primaryGoal: z.string().max(2000),
  brandVoice: z.string().max(2000),
});
type OnboardingDnaForm = z.infer<typeof OnboardingDnaFormSchema>;

export const setOnboardingPath = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { path: OnboardingPath }) =>
    z.object({ path: z.enum(["agent_builder", "grow", "both"]) }).parse(d),
  )
  .handler(async ({ data, context }): Promise<OnboardingState> => {
    const { workspaceId, userId } = context;
    const sb = supabaseAdmin as any;

    const { data: row } = await sb
      .from("workspace_onboarding")
      .upsert(
        { workspace_id: workspaceId, user_id: userId, path: data.path, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id" }
      )
      .select()
      .single();

    return {
      exists: true,
      path: row?.path ?? data.path,
      completed: row?.completed ?? false,
      dismissed: row?.dismissed ?? false,
      business_dna_done: row?.business_dna_done ?? false,
      knowledge_uploaded: row?.knowledge_uploaded ?? false,
      connections_done: row?.connections_done ?? false,
      first_agent_done: row?.first_agent_done ?? false,
      first_campaign_done: row?.first_campaign_done ?? false,
      analysis_done: row?.analysis_done ?? false,
      telephony_done: row?.telephony_done ?? false,
      crm_choice: row?.crm_choice ?? null,
    };
  });

export const completeOnboardingStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: OnboardingStepPatch) => OnboardingStepPatchSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { workspaceId, userId } = context;
    const sb = supabaseAdmin as any;

    await sb
      .from("workspace_onboarding")
      .upsert(
        { workspace_id: workspaceId, user_id: userId, ...data, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id" }
      );

    return { ok: true };
  });

export const dismissOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean }> => {
    const { workspaceId, userId } = context;
    const sb = supabaseAdmin as any;

    await sb
      .from("workspace_onboarding")
      .upsert(
        { workspace_id: workspaceId, user_id: userId, dismissed: true, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id" }
      );

    return { ok: true };
  });

// Quick Business DNA save during onboarding wizard
export const saveOnboardingBusinessDna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: OnboardingDnaForm) => OnboardingDnaFormSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { workspaceId } = context;
    const sb = supabaseAdmin as any;
    const f = data;

    await sb.from("growthmind_business_dna").upsert(
      {
        workspace_id: workspaceId,
        company_name: f.companyName,
        industry: f.industry,
        website: f.website,
        locations: f.locations,
        ideal_customer_profiles: f.targetCustomers,
        main_growth_objective: f.primaryGoal,
        brand_voice: f.brandVoice,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" }
    );

    await sb
      .from("workspace_onboarding")
      .update({ business_dna_done: true, updated_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);

    return { ok: true };
  });
