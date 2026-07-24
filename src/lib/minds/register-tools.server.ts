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
import type { MindKey, MindToolCost } from "./tool-registry.shared";

// ── HiveMind action kinds (executed via approve flow → registry) ────────────
interface HiveMindKind {
  type: string;
  mind: MindKey;
  title: string;
  description: string;
  cost: MindToolCost;
  affected?: (result: Record<string, any>) => { type: string; id: string | null } | null;
}

const HIVEMIND_ACTION_KINDS: HiveMindKind[] = [
  { type: "create_task", mind: "hivemind", title: "Create task", description: "Create an internal HiveMind task for the team.", cost: "none",
    affected: (r) => (r?.task_id ? { type: "hivemind_task", id: String(r.task_id) } : null) },
  { type: "run_orchestration_playbook", mind: "hivemind", title: "Run orchestration playbook", description: "Chain analyses across the AI executives and create a coordinated, linked task plan (proposal-only; never bypasses approvals).", cost: "low",
    affected: (r) => (r?.run_id ? { type: "hivemind_orchestration_run", id: String(r.run_id) } : null) },
  { type: "create_followup_campaign", mind: "hivemind", title: "Create follow-up campaign", description: "Create a HexMail follow-up campaign (draft) and optionally enroll leads.", cost: "low",
    affected: (r) => (r?.campaign_id ? { type: "hexmail_campaign", id: String(r.campaign_id) } : null) },
  { type: "enroll_leads_in_campaign", mind: "hivemind", title: "Enroll leads in campaign", description: "Enroll leads into an existing follow-up campaign.", cost: "low" },
  { type: "move_pipeline_stage", mind: "hivemind", title: "Move pipeline stage", description: "Move leads to a different sales pipeline stage.", cost: "none" },
  { type: "assign_knowledge_base", mind: "hivemind", title: "Assign knowledge base", description: "Assign a knowledge base to an agent.", cost: "none" },
  { type: "register_resend_webhook", mind: "hivemind", title: "Register Resend webhook", description: "Register the Resend deliverability webhook for this workspace.", cost: "none" },
  { type: "sync_ad_stats", mind: "growthmind", title: "Sync ad stats", description: "Refresh connected ad platform statistics.", cost: "low" },
  { type: "growthmind_video_campaign", mind: "growthmind", title: "Video campaign", description: "Generate a GrowthMind video campaign draft.", cost: "high" },
  { type: "growthmind_growth_campaign", mind: "growthmind", title: "Growth campaign", description: "Create a coordinated GrowthMind growth campaign.", cost: "medium" },
  { type: "growthmind_publish_content", mind: "growthmind", title: "Publish content", description: "Publish approved content to a connected social account.", cost: "low" },
  { type: "send_workflow_draft_to_builder", mind: "systemmind", title: "Send workflow draft to builder", description: "Hand a generated workflow draft to the Workflow Builder.", cost: "none" },
  { type: "activate_lead_intake_workflow", mind: "systemmind", title: "Activate lead-intake workflow", description: "Activate the webform → auto-call lead intake workflow.", cost: "medium" },
  { type: "activate_systemmind_automation", mind: "systemmind", title: "Activate SystemMind automation", description: "Activate an approved SystemMind automation draft.", cost: "medium" },
];

function entitlementForActionType(actionType: string): ActionKey | undefined {
  const cat = sensitiveCategoryOf(actionType);
  return cat ? CATEGORY_ENTITLEMENT[cat] : undefined;
}

for (const kind of HIVEMIND_ACTION_KINDS) {
  registerMindTool({
    name: `hivemind.${kind.type}`,
    mind: kind.mind,
    title: kind.title,
    description: kind.description,
    access: "write",
    surface: "registry",
    sensitive: isSensitiveActionType(kind.type),
    requiredActionKey: entitlementForActionType(kind.type),
    modeGateActionType: kind.type,
    idempotent: false,
    estimatedCost: kind.cost,
    platforms: ["web", "mobile", "api", "system"],
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
  run: async (ctx: MindToolContext): Promise<MindToolRunResult> => {
    // String-literal dynamic import (prod Rollup requirement).
    const { listOrchestrationRuns } = await import("@/lib/hivemind/orchestration.server");
    const r = await listOrchestrationRuns(ctx.sb, ctx.workspaceId);
    return { result: { runs: r.runs, error: r.error } };
  },
});

// ── Declared capabilities (catalog completeness; executed on their own
//    surfaces, audited there via auditServerFnToolRun where consequential) ───
type Declared = {
  name: string; mind: MindKey; title: string; description: string;
  access: "read" | "write"; surface: "server_fn" | "hivemind_action";
  sensitive?: boolean; requiredActionKey?: ActionKey; cost?: MindToolCost;
};

const DECLARED: Declared[] = [
  // GrowthMind
  { name: "growthmind.create_content_project", mind: "growthmind", title: "Create content project", description: "Create a Content Studio project draft.", access: "write", surface: "server_fn" },
  { name: "growthmind.submit_content_for_approval", mind: "growthmind", title: "Submit content for approval", description: "Submit a Content Studio project for human approval (publishes only after approval).", access: "write", surface: "server_fn" },
  { name: "growthmind.run_campaign_proposals", mind: "growthmind", title: "Run campaign proposal engine", description: "Generate campaign proposals from live performance data.", access: "write", surface: "server_fn" },
  { name: "growthmind.chat_send_to_content_studio", mind: "growthmind", title: "Chat: send concept to Content Studio", description: "GrowthMind chat sends a trend/adaptation recommendation to Content Studio as a project draft.", access: "write", surface: "server_fn" },
  { name: "growthmind.chat_reschedule_publish", mind: "growthmind", title: "Chat: reschedule approved publish", description: "GrowthMind chat moves the scheduled time of an ALREADY-APPROVED publishing job. Unapproved content still requires human approval.", access: "write", surface: "server_fn" },
  // SystemMind
  { name: "systemmind.generate_report", mind: "systemmind", title: "Generate analytics report", description: "Generate a SystemMind analytics report.", access: "write", surface: "server_fn" },
  { name: "systemmind.build_session", mind: "systemmind", title: "Build Workspace session", description: "Iterative agent/workflow build sessions with immutable versions; applying goes through approval.", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "systemmind_approval" },
  // AccountsMind
  { name: "accountsmind.save_invoice_draft", mind: "accountsmind", title: "Save invoice draft", description: "Create or update a draft invoice.", access: "write", surface: "server_fn", requiredActionKey: "billing" },
  { name: "accountsmind.issue_invoice", mind: "accountsmind", title: "Issue invoice", description: "Issue a draft invoice (locks it and assigns the final number).", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "billing" },
  { name: "accountsmind.record_invoice_payment", mind: "accountsmind", title: "Record invoice payment", description: "Record a payment against an issued invoice. Requires authorised evidence or user approval.", access: "write", surface: "server_fn", sensitive: true, requiredActionKey: "billing" },
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
  });
}
