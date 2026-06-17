import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertAdmin(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (!data || data.length === 0) throw new Error("Forbidden");
}

// ── Module catalog ─────────────────────────────────────────────────────────

export interface ModuleDef {
  id: string;
  name: string;
  description: string;
  price: string;
  flags: string[];
  color: string;
}

export const MODULE_CATALOG: ModuleDef[] = [
  {
    id: "receptionist",
    name: "Receptionist",
    description: "AI inbound receptionist, appointment booking, call logs",
    price: "£297/mo",
    flags: ["receptionist_agent", "inbound_calls", "appointment_booking"],
    color: "#60a5fa",
  },
  {
    id: "lead_generation",
    name: "Lead Generation",
    description: "Outbound calling, CSV campaigns, lead lists & analytics",
    price: "+£250/mo",
    flags: ["outbound_campaigns", "csv_calling", "lead_generation_agents"],
    color: "#4ade80",
  },
  {
    id: "qualification",
    name: "Client Qualification",
    description: "Qualification agents, lead scoring, pipeline automation",
    price: "+£300/mo",
    flags: ["qualification_agents", "lead_scoring", "qualified_pipeline_automation"],
    color: "#f59e0b",
  },
  {
    id: "growthmind",
    name: "GrowthMind",
    description: "AI CMO — Campaign Factory, Content Studio, SEO Centre, Business DNA",
    price: "+£250/mo",
    flags: ["growthmind", "campaign_factory", "content_studio", "seo_centre"],
    color: "#a78bfa",
  },
  {
    id: "whatsapp",
    name: "WhatsApp Centre",
    description: "WhatsApp inbox, broadcasts, AI agents, templates",
    price: "+£99/mo",
    flags: ["whatsapp_centre", "whatsapp_broadcasts", "whatsapp_agents"],
    color: "#34d399",
  },
  {
    id: "video",
    name: "Video & Creative Studio",
    description: "Video Studio (Veo), Image Studio, ad creative generation",
    price: "+£99/mo",
    flags: ["video_studio", "image_studio", "creative_assets"],
    color: "#f472b6",
  },
  {
    id: "builder",
    name: "Builder",
    description: "Agent Builder, Flow Builder, Knowledge Builder, testing tools",
    price: "£97/mo",
    flags: ["builder", "agent_testing", "flow_builder"],
    color: "#94a3b8",
  },
  {
    id: "hivemind",
    name: "HiveMind",
    description: "AI COO — observe, recommend, assist and operate",
    price: "Included in bundles",
    flags: ["hivemind", "hivemind_coo"],
    color: "#f5b800",
  },
  {
    id: "systemmind",
    name: "SystemMind",
    description: "AI CTO — workflow library, repair engine, system intelligence",
    price: "Included in Business Command+",
    flags: ["systemmind", "systemmind_cto"],
    color: "#38bdf8",
  },
  {
    id: "accountsmind",
    name: "AccountsMind",
    description: "Client billing, MRR/ARR tracking, cost engine",
    price: "Included in Scale+",
    flags: ["accountsmind"],
    color: "#e879f9",
  },
];

// ── Read workspace modules (user) ──────────────────────────────────────────

export const getWorkspaceModules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("default_workspace_id")
      .eq("user_id", userId)
      .maybeSingle();
    const workspaceId = profile?.default_workspace_id;
    if (!workspaceId) return { activeModules: [] as string[], planTier: "free" };

    const { data: settings } = await supabase
      .from("workspace_settings")
      .select("active_modules, plan_tier")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    return {
      activeModules: (settings?.active_modules as string[]) ?? [],
      planTier: (settings?.plan_tier as string) ?? "free",
    };
  });

// ── Admin: list all workspaces with modules ────────────────────────────────

export const adminListWorkspacesWithModules = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("workspaces")
      .select(`
        id,
        name,
        workspace_settings (
          plan_tier,
          active_modules,
          modules_updated_at
        ),
        workspace_members (count)
      `)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ── Admin: set modules for a workspace ───────────────────────────────────

export const adminSetWorkspaceModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspaceId: string; modules: string[]; planTier: string }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { error } = await supabaseAdmin
      .from("workspace_settings")
      .upsert({
        workspace_id: data.workspaceId,
        active_modules: data.modules,
        plan_tier: data.planTier,
        modules_updated_at: new Date().toISOString(),
      }, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── User: request module upgrade ──────────────────────────────────────────

export const requestModuleUpgrade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { moduleId: string; moduleName: string; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase
      .from("profiles")
      .select("default_workspace_id")
      .eq("user_id", userId)
      .maybeSingle();
    const workspaceId = profile?.default_workspace_id;
    if (!workspaceId) throw new Error("No workspace found");

    // Deduplicate: don't create duplicate pending request
    const { data: existing } = await supabase
      .from("module_upgrade_requests")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("module_id", data.moduleId)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) return { ok: true, alreadyPending: true };

    const { error } = await supabase
      .from("module_upgrade_requests")
      .insert({
        workspace_id: workspaceId,
        requested_by: userId,
        module_id: data.moduleId,
        module_name: data.moduleName,
        notes: data.notes ?? null,
      });
    if (error) throw new Error(error.message);
    return { ok: true, alreadyPending: false };
  });

// ── Admin: list module upgrade requests ──────────────────────────────────

export const adminListModuleRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { data, error } = await supabaseAdmin
      .from("module_upgrade_requests")
      .select(`
        id, module_id, module_name, status, notes, created_at, reviewed_at,
        workspace_id,
        workspaces!inner ( name )
      `)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ── Admin: approve or deny a module request ───────────────────────────────

export const adminDecideModuleRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { requestId: string; approve: boolean }) => d)
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);

    const { data: req, error: fetchErr } = await supabaseAdmin
      .from("module_upgrade_requests")
      .select("workspace_id, module_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (fetchErr || !req) throw new Error("Request not found");

    await supabaseAdmin
      .from("module_upgrade_requests")
      .update({
        status: data.approve ? "approved" : "denied",
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.requestId);

    // If approving: add the module to the workspace
    if (data.approve) {
      const { data: settings } = await supabaseAdmin
        .from("workspace_settings")
        .select("active_modules")
        .eq("workspace_id", req.workspace_id)
        .maybeSingle();
      const current = (settings?.active_modules as string[]) ?? [];
      if (!current.includes(req.module_id)) {
        await supabaseAdmin
          .from("workspace_settings")
          .upsert({
            workspace_id: req.workspace_id,
            active_modules: [...current, req.module_id],
            modules_updated_at: new Date().toISOString(),
          }, { onConflict: "workspace_id" });
      }
    }

    return { ok: true };
  });
