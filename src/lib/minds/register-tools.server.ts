/**
 * Registers every existing Mind capability in the shared tool registry.
 *
 * HiveMind action kinds are directly executable ("registry" surface) — the
 * approve flow in hivemind.actions.ts dispatches through executeMindTool(),
 * which calls back into the existing executeAction() implementation, so web
 * behavior is unchanged while every execution is audited.
 *
 * GrowthMind / SystemMind / AccountsMind server functions are declared with
 * the "server_fn" or "hivemind_action" surface so the catalog is complete;
 * their handlers report runs via auditServerFnToolRun() where consequential.
 *
 * Imported lazily (once) by tool-registry.server.ts.
 */
import { z } from "zod";
import {
  SENSITIVE_ACTIONS,
  CATEGORY_ENTITLEMENT,
  sensitiveCategoryOf,
  isSensitiveActionType,
} from "@/lib/hivemind/action-safety.shared";
import type { ActionKey } from "@/lib/permissions/permissions.shared";
import { registerMindTool, type MindToolContext, type MindToolRunResult } from "./tool-registry.server";
import type { MindKey, MindToolCost, CapabilityState } from "./tool-registry.shared";
// HiveMind executive control tools over GrowthMind (registers on import).
import "@/lib/hivemind/growthmind-control/tools.server";
// GrowthMind SEO department tools (registers on import).
import "@/lib/minds/register-seo-tools.server";
import "@/lib/minds/register-notification-tools.server";
import "@/lib/minds/register-content-tools.server";
// Website UX / conversion-diagnosis tools (registers on import).
import "@/lib/minds/register-website-tools.server";
import "@/lib/hivemind/growthmind-control/marketing-objective-tools.server";

// ── HiveMind action kinds (executed via approve flow → registry) ────────────
interface HiveMindKind {
  type: string;
  mind: MindKey;
  title: string;
  description: string;
  cost: MindToolCost;
  featureFamily: string;
  requiredIntegrations?: string[];
  capabilityState?: CapabilityState;
  affected?: (result: Record<string, any>) => { type: string; id: string | null } | null;
}

const HIVEMIND_ACTION_KINDS: HiveMindKind[] = [
  {
    type: "create_task", mind: "hivemind", featureFamily: "task_management",
    title: "Create task", description: "Create an internal HiveMind task for the team.", cost: "none",
    affected: (r) => (r?.task_id ? { type: "hivemind_task", id: String(r.task_id) } : null),
  },
  {
    type: "run_orchestration_playbook", mind: "hivemind", featureFamily: "orchestration",
    title: "Run orchestration playbook", description: "Chain analyses across the AI executives and create a coordinated, linked task plan (proposal-only; never bypasses approvals).", cost: "low",
    affected: (r) => (r?.run_id ? { type: "hivemind_orchestration_run", id: String(r.run_id) } : null),
  },
  {
    type: "create_followup_campaign", mind: "hivemind", featureFamily: "email_campaign",
    title: "Create follow-up campaign", description: "Create a HexMail follow-up campaign (draft) and optionally enroll leads.", cost: "low",
    affected: (r) => (r?.campaign_id ? { type: "hexmail_campaign", id: String(r.campaign_id) } : null),
  },
  {
    type: "enroll_leads_in_campaign", mind: "hivemind", featureFamily: "campaign_management",
    title: "Enroll leads in campaign", description: "Enroll leads into an existing follow-up campaign.", cost: "low",
  },
  {
    type: "move_pipeline_stage", mind: "hivemind", featureFamily: "pipeline_management",
    title: "Move pipeline stage", description: "Move leads to a different sales pipeline stage.", cost: "none",
  },
  {
    type: "assign_knowledge_base", mind: "hivemind", featureFamily: "agent_configuration",
    title: "Assign knowledge base", description: "Assign a knowledge base to an agent.", cost: "none",
  },
  {
    type: "register_resend_webhook", mind: "hivemind", featureFamily: "integration_management",
    title: "Register Resend webhook", description: "Register the Resend deliverability webhook for this workspace.", cost: "none",
  },
  {
    type: "sync_ad_stats", mind: "growthmind", featureFamily: "ads_management",
    title: "Sync ad stats", description: "Refresh connected ad platform statistics.", cost: "low",
  },
  {
    type: "gads_create_change_requests", mind: "growthmind", featureFamily: "ads_management",
    requiredIntegrations: ["google_ads"],
    title: "Create Google Ads change requests", description: "Convert approved analysis recommendations into internal change-request drafts. Never applies live Google Ads changes.", cost: "none",
  },
  {
    type: "growthmind_video_campaign", mind: "growthmind", featureFamily: "content_production",
    title: "Video campaign", description: "Generate a GrowthMind video campaign draft.", cost: "high",
  },
  {
    type: "growthmind_growth_campaign", mind: "growthmind", featureFamily: "campaign_management",
    title: "Growth campaign", description: "Create a coordinated GrowthMind growth campaign.", cost: "medium",
  },
  {
    type: "growthmind_publish_content", mind: "growthmind", featureFamily: "content_publishing",
    title: "Publish content", description: "Publish approved content to a connected social account.", cost: "low",
  },
  {
    type: "send_workflow_draft_to_builder", mind: "systemmind", featureFamily: "workflow_management",
    title: "Send workflow draft to builder", description: "Hand a generated workflow draft to the Workflow Builder.", cost: "none",
  },
  {
    type: "activate_lead_intake_workflow", mind: "systemmind", featureFamily: "lead_management",
    title: "Activate lead-intake workflow", description: "Activate the webform → auto-call lead intake workflow.", cost: "medium",
  },
  {
    type: "activate_systemmind_automation", mind: "systemmind", featureFamily: "automation_management",
    title: "Activate SystemMind automation", description: "Activate an approved SystemMind automation draft.", cost: "medium",
  },
  {
    type: "seo_campaign_approval", mind: "hivemind", featureFamily: "seo",
    title: "Approve SEO campaign stage", description: "Approve one stage of an SEO blog campaign (strategy, brief, content or deployment). Moves the campaign exactly one stage forward; deployment stays a manual Lovable handoff.", cost: "low",
  },
  {
    type: "marketing_action_execute", mind: "hivemind", featureFamily: "marketing_automation",
    title: "Execute marketing action", description: "Execute an approved Marketing Action Engine change (confirm-then-verify against the real platform API; guardrails re-checked at execution time).", cost: "low",
    affected: (r) => (r?.marketing_action_id ? { type: "marketing_action", id: String(r.marketing_action_id) } : null),
  },
  {
    type: "content_publication_approval", mind: "hivemind", featureFamily: "content_publishing",
    title: "Approve public article content/publication", description: "Approve article content or publication for the public content API. Content approval and publication approval are separate steps; publishing to the API never claims the article is live on the website.", cost: "low",
  },
];

function entitlementForActionType(actionType: string): ActionKey | undefined {
  const cat = sensitiveCategoryOf(actionType);
  return cat ? CATEGORY_ENTITLEMENT[cat] : undefined;
}

for (const kind of HIVEMIND_ACTION_KINDS) {
  const isSensitive = isSensitiveActionType(kind.type);
  registerMindTool({
    name: `hivemind.${kind.type}`,
    mind: kind.mind,
    title: kind.title,
    description: kind.description,
    access: "write",
    surface: "registry",
    sensitive: isSensitive,
    requiredActionKey: entitlementForActionType(kind.type),
    modeGateActionType: kind.type,
    idempotent: false,
    estimatedCost: kind.cost,
    platforms: ["web", "mobile", "api", "system"],
    featureFamily: kind.featureFamily,
    capabilityState: kind.capabilityState ?? (isSensitive ? "approval_required" : "available"),
    requiredIntegrations: kind.requiredIntegrations ?? [],
    rollbackSupported: false,
    mobileAvailable: true,
    currentHealth: "healthy",
    inputSchema: z.object({
      action: z.object({
        id: z.string(),
        action_type: z.string(),
        action_payload: z.record(z.string(), z.any()).default({}),
      }).passthrough(),
    }),
    run: async (ctx: MindToolContext, input: { action: any }): Promise<MindToolRunResult> => {
      if (input.action.action_type !== kind.type) {
        throw new Error(`Action type mismatch: expected ${kind.type}, got ${input.action.action_type}`);
      }
      // String-literal dynamic import (prod Rollup requirement); avoids a
      // static cycle with hivemind.actions.ts.
      const { executeAction } = await import("@/lib/hivemind/hivemind.actions");
      const result = await executeAction(ctx.sb, ctx.workspaceId, input.action);
      const affected = kind.affected?.(result) ?? null;
      return {
        result,
        affectedRecordType: affected?.type ?? "hivemind_action",
        affectedRecordId: affected?.id ?? String(input.action.id),
      };
    },
  });
}

// ── Orchestration runs (read tool — registry surface) ───────────────────────
registerMindTool({
  name: "hivemind.list_orchestration_runs",
  mind: "hivemind",
  title: "List orchestration runs",
  description: "List recent cross-Mind orchestration playbook runs with their coordinated recommendations, linked tasks and escalations.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "orchestration",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    // String-literal dynamic import (prod Rollup requirement).
    const { listOrchestrationRuns } = await import("@/lib/hivemind/orchestration.server");
    const r = await listOrchestrationRuns(ctx.sb, ctx.workspaceId);
    return { result: { runs: r.runs, error: r.error } };
  },
});

registerMindTool({
  name: "hivemind.get_campaign_minutes_used",
  mind: "hivemind",
  title: "Get campaign minutes used",
  description: "Per-campaign call minutes-used usage for this workspace: total/connected/voicemail minutes, calls, today/week/month windows, % of workspace, plus the Unassigned Campaign bucket. Real call durations only — no estimates.",
  access: "read",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api", "system"],
  featureFamily: "analytics",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    dateFilter: z.string().optional(),
    campaignId: z.string().optional(),
  }).optional(),
  run: async (ctx: MindToolContext, input?: { dateFilter?: string; campaignId?: string }): Promise<MindToolRunResult> => {
    // String-literal dynamic import (prod Rollup requirement).
    const { getCampaignUsageData, stripProviderCostData } = await import("@/lib/analytics-hub/campaign-usage.server");
    // Provider costs are WEBEE-internal — Mind responses are client-facing.
    const d = stripProviderCostData(await getCampaignUsageData(ctx.workspaceId, {
      dateFilter: (input?.dateFilter ?? "30d") as any,
      campaignId: input?.campaignId ?? null,
    }));
    return {
      result: {
        mode: d.mode,
        range: d.range,
        workspace: d.workspace,
        campaigns: d.campaigns,
        unassigned: d.unassigned,
        truncated: d.truncated,
        error: d.error,
      },
    };
  },
});

// ── Declared capabilities (catalog completeness; executed on their own
//    surfaces, audited there via auditServerFnToolRun where consequential) ───
type Declared = {
  name: string; mind: MindKey; title: string; description: string;
  access: "read" | "write"; surface: "server_fn" | "hivemind_action";
  sensitive?: boolean; requiredActionKey?: ActionKey; cost?: MindToolCost;
  featureFamily?: string;
};

const DECLARED: Declared[] = [
  // GrowthMind
  { name: "growthmind.create_content_project", mind: "growthmind", featureFamily: "content_production", title: "Create content project", description: "Create a Content Studio project draft.", access: "write", surface: "server_fn" },
  { name: "growthmind.submit_content_for_approval", mind: "growthmind", featureFamily: "content_publishing", title: "Submit content for approval", description: "Submit a Content Studio project for human approval (publishes only after approval).", access: "write", surface: "server_fn" },
  { name: "growthmind.run_campaign_proposals", mind: "growthmind", featureFamily: "campaign_management", title: "Run campaign proposal engine", description: "Generate campaign proposals from live performance data.", access: "write", surface: "server_fn" },
  { name: "growthmind.chat_send_to_content_studio", mind: "growthmind", featureFamily: "content_production", title: "Chat: send concept to Content Studio", description: "GrowthMind chat sends a trend/adaptation recommendation to Content Studio as a project draft.", access: "write", surface: "server_fn" },
  { name: "growthmind.chat_reschedule_publish", mind: "growthmind", featureFamily: "content_publishing", title: "Chat: reschedule approved publish", description: "GrowthMind chat moves the scheduled time of an ALREADY-APPROVED publishing job. Unapproved content still requires human approval.", access: "write", surface: "server_fn" },
  // SystemMind
  { name: "systemmind.generate_report", mind: "systemmind", featureFamily: "analytics", title: "Generate analytics report", description: "Generate a SystemMind analytics report.", access: "write", surface: "server_fn" },
  { name: "systemmind.build_session", mind: "systemmind", featureFamily: "workflow_management", title: "Build Workspace session", description: "Iterative agent/workflow build sessions with immutable versions; applying goes through approval.", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "systemmind_approval" },
  // AccountsMind
  { name: "accountsmind.save_invoice_draft", mind: "accountsmind", featureFamily: "finance", title: "Save invoice draft", description: "Create or update a draft invoice.", access: "write", surface: "server_fn", requiredActionKey: "billing" },
  { name: "accountsmind.issue_invoice", mind: "accountsmind", featureFamily: "finance", title: "Issue invoice", description: "Issue a draft invoice (locks it and assigns the final number).", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "billing" },
  { name: "accountsmind.record_invoice_payment", mind: "accountsmind", featureFamily: "finance", title: "Record invoice payment", description: "Record a payment against an issued invoice. Requires authorised evidence or user approval.", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "billing" },
];

for (const d of DECLARED) {
  registerMindTool({
    name: d.name,
    mind: d.mind,
    title: d.title,
    description: d.description,
    access: d.access,
    surface: d.surface,
    sensitive: d.sensitive === true || d.name in SENSITIVE_ACTIONS,
    requiredActionKey: d.requiredActionKey,
    idempotent: false,
    estimatedCost: d.cost ?? "low",
    platforms: ["web", "mobile", "api"],
    featureFamily: d.featureFamily,
    capabilityState: (d.sensitive === true) ? "approval_required" : "available",
    rollbackSupported: false,
    mobileAvailable: true,
    currentHealth: "healthy",
  });
}

// ── SystemMind call-workflow setup tools (registry surface — chat executable) ─
// Chat proposes these; sensitive ones ALWAYS require explicit human approval
// (approval_required) before executeMindTool runs them.
// Every run-path re-checks SystemMind edit access + WBAH exclusion so the
// registry surface enforces the SAME authorization as the server-fn surface.

async function gateCallWorkflowTool(ctx: MindToolContext): Promise<void> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(ctx.workspaceId);
  const { requireSystemMindEdit } = await import("@/lib/systemmind/systemmind-access.server");
  await requireSystemMindEdit(ctx.workspaceId, ctx.userId);
}

registerMindTool({
  name: "systemmind.run_call_workflow_test",
  mind: "systemmind",
  title: "Run call workflow test",
  description: "Run the 12-check end-to-end workflow test for a draft/active call workflow version and store the evidence.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "workflow_management",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ activationId: z.string().uuid() }),
  run: async (ctx: MindToolContext, input: { activationId: string }): Promise<MindToolRunResult> => {
    await gateCallWorkflowTool(ctx);
    const { runWorkflowTestsServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    const res = await runWorkflowTestsServer({
      workspaceId: ctx.workspaceId, userId: ctx.userId, activationId: input.activationId,
    });
    return {
      result: { passed: res.passed, failed: res.checks.filter((c) => !c.ok && !c.skipped).map((c) => c.key) },
      affectedRecordType: "systemmind_workflow_activations",
      affectedRecordId: input.activationId,
    };
  },
});

registerMindTool({
  name: "systemmind.activate_call_workflow",
  mind: "systemmind",
  title: "Activate call workflow",
  description: "Activate a tested call workflow version (supersedes the previous active version). High impact — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  requiredActionKey: "systemmind_approval",
  idempotent: false,
  estimatedCost: "medium",
  platforms: ["web", "mobile", "api"],
  featureFamily: "workflow_management",
  capabilityState: "approval_required",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ activationId: z.string().uuid() }),
  run: async (ctx: MindToolContext, input: { activationId: string }): Promise<MindToolRunResult> => {
    await gateCallWorkflowTool(ctx);
    const { activateWorkflowServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    const res = await activateWorkflowServer({
      workspaceId: ctx.workspaceId, userId: ctx.userId, activationId: input.activationId,
    });
    if (!res.ok) throw new Error(res.error ?? "activation_failed");
    return {
      result: { activated: true, version: res.activation?.version_number },
      affectedRecordType: "systemmind_workflow_activations",
      affectedRecordId: input.activationId,
    };
  },
});

registerMindTool({
  name: "systemmind.set_call_workflow_state",
  mind: "systemmind",
  title: "Pause / resume / roll back call workflow",
  description: "Pause, resume or roll back an active call workflow version. High impact — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  requiredActionKey: "systemmind_approval",
  idempotent: false,
  estimatedCost: "low",
  platforms: ["web", "mobile", "api"],
  featureFamily: "workflow_management",
  capabilityState: "approval_required",
  rollbackSupported: true,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    activationId: z.string().uuid(),
    action: z.enum(["pause", "resume", "rollback"]),
  }),
  run: async (ctx: MindToolContext, input: { activationId: string; action: "pause" | "resume" | "rollback" }): Promise<MindToolRunResult> => {
    await gateCallWorkflowTool(ctx);
    const { setWorkflowStateServer } = await import("@/lib/systemmind/call-runtime/setup-wizard.server");
    const res = await setWorkflowStateServer({
      workspaceId: ctx.workspaceId, userId: ctx.userId,
      activationId: input.activationId, action: input.action,
    });
    if (!res.ok) throw new Error(res.error ?? "state_change_failed");
    return {
      result: { action: input.action, ok: true },
      affectedRecordType: "systemmind_workflow_activations",
      affectedRecordId: input.activationId,
    };
  },
});

registerMindTool({
  name: "systemmind.save_call_trigger",
  mind: "systemmind",
  title: "Save call trigger",
  description: "Create or update a call trigger (e.g. \"only call leads between 9 AM and 6 PM\"). Changes calling behavior — requires explicit approval.",
  access: "write",
  surface: "registry",
  sensitive: true,
  requiredActionKey: "systemmind_approval",
  idempotent: false,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api"],
  featureFamily: "agent_configuration",
  capabilityState: "approval_required",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({
    id: z.string().uuid().nullish(),
    agentId: z.string().uuid(),
    name: z.string().max(200).optional(),
    triggerType: z.string(),
    enabled: z.boolean().optional(),
    conditions: z.record(z.string(), z.any()).optional(),
    callingWindow: z.record(z.string(), z.any()).optional(),
    maxAttempts: z.number().int().min(1).max(10).optional(),
    dailyCap: z.number().int().min(1).max(2000).optional(),
    dedupWindowMinutes: z.number().int().min(0).max(43200).optional(),
    schedule: z.record(z.string(), z.any()).optional(),
  }),
  run: async (ctx: MindToolContext, input: any): Promise<MindToolRunResult> => {
    await gateCallWorkflowTool(ctx);
    const { saveCallTriggerServer } = await import("@/lib/systemmind/call-runtime/triggers.server");
    const row = await saveCallTriggerServer({
      workspaceId: ctx.workspaceId, userId: ctx.userId,
      ...input,
      name: input.name ?? `${String(input.triggerType).replace(/_/g, " ")} trigger`,
    });
    return {
      result: { summary: row?.summary, enabled: row?.enabled },
      affectedRecordType: "systemmind_call_triggers",
      affectedRecordId: row?.id ?? null,
    };
  },
});

registerMindTool({
  name: "systemmind.retry_crm_writeback",
  mind: "systemmind",
  title: "Retry CRM write-back",
  description: "Retry a failed CRM update (integration error) now.",
  access: "write",
  surface: "registry",
  sensitive: false,
  idempotent: true,
  estimatedCost: "none",
  platforms: ["web", "mobile", "api"],
  featureFamily: "integration_management",
  capabilityState: "available",
  rollbackSupported: false,
  mobileAvailable: true,
  currentHealth: "healthy",
  inputSchema: z.object({ errorId: z.string().uuid() }),
  run: async (ctx: MindToolContext, input: { errorId: string }): Promise<MindToolRunResult> => {
    await gateCallWorkflowTool(ctx);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin as any;
    const { data: row } = await sb
      .from("systemmind_integration_errors")
      .select("id")
      .eq("id", input.errorId)
      .eq("workspace_id", ctx.workspaceId)
      .maybeSingle();
    if (!row) throw new Error("integration_error_not_found");
    const { error } = await sb
      .from("systemmind_integration_errors")
      .update({ status: "pending", next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", input.errorId);
    if (error) throw new Error(error.message);
    return {
      result: { retryScheduled: true },
      affectedRecordType: "systemmind_integration_errors",
      affectedRecordId: input.errorId,
    };
  },
});
