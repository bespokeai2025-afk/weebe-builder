// ── SystemMind People-View / Campaign-Filter kinds — server-only ────────────
// Lets SystemMind draft workspace-scoped People views and campaign filters via
// the Automation Layer hub (systemmind_generated_actions). Hub-only kinds: all
// structure lives in the hub payload (no detail table). Lifecycle: draft →
// pending_approval → active, activated ONLY from activateSystemMindAutomation.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context.
//   • Filter configs are validated against the filter-engine field registry
//     BEFORE storing the draft; unknown fields fail the draft.
//   • A dry-run is executed at draft time and stored in the payload so the
//     approver sees real counts.
//   • Activation re-validates and creates the object via the standard CRUD
//     layer (versioned + audited) — never raw inserts.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import {
  FILTER_FIELDS,
  FILTER_OPERATORS,
  validateFilterConfig,
  safetyConfigSchema,
  runFilterDryRun,
  DEFAULT_SAFETY,
} from "./filter-engine.server";
import {
  createPeopleView,
  createCampaignFilter,
  updatePeopleView,
  updateCampaignFilter,
  convertViewToCampaignFilter,
} from "./people-views.server";

type Sb = any;

// ── run helpers (mirrors generators module) ─────────────────────────────────
async function createRun(sb: Sb, workspaceId: string, userId: string | null, instructedBy: string, runType: string, description: string): Promise<string> {
  const { data, error } = await sb.from("systemmind_runs").insert({
    workspace_id: workspaceId,
    created_by_user_id: userId,
    instructed_by: instructedBy,
    run_type: runType,
    input_description: description.slice(0, 4000),
    status: "running",
  }).select("id").single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data.id as string;
}

async function completeRun(sb: Sb, workspaceId: string, runId: string, routed: { provider?: string; model?: string; usedFallback?: boolean; fallbackFrom?: string | null; inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null } | null): Promise<void> {
  await sb.from("systemmind_runs").update({
    status: "completed",
    model_provider: routed?.provider ?? null,
    model_id: routed?.model ?? null,
    used_fallback: routed?.usedFallback ?? false,
    fallback_from: routed?.fallbackFrom ?? null,
    input_tokens: routed?.inputTokens ?? null,
    output_tokens: routed?.outputTokens ?? null,
    cost_usd: routed?.costUsd ?? null,
    completed_at: new Date().toISOString(),
  }).eq("id", runId).eq("workspace_id", workspaceId);
}

async function failRun(sb: Sb, workspaceId: string, runId: string, err: unknown): Promise<void> {
  await sb.from("systemmind_runs").update({
    status: "failed",
    error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    completed_at: new Date().toISOString(),
  }).eq("id", runId).eq("workspace_id", workspaceId);
}

function routedArgs(workspaceId: string, sb: Sb) {
  const claudeEnabled = isClaudeEnabled();
  return {
    contentType: "systemmind_automation",
    mode: "manual" as const,
    provider: claudeEnabled ? ("claude" as const) : ("openai" as const),
    model: claudeEnabled ? ("claude-sonnet-4-5" as const) : ("gpt-4.1" as const),
    settings: {},
    workspaceId,
    sb,
  };
}

function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Model returned invalid JSON — try again or rephrase the request.");
  }
}

// ── Draft schema ─────────────────────────────────────────────────────────────
const DraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  object_type: z.enum(["people_view", "campaign_filter"]),
  filter_config: z.object({
    logic: z.enum(["and", "or"]).default("and"),
    conditions: z.array(z.object({
      field: z.string().min(1).max(120),
      operator: z.string().min(1).max(40),
      value: z.unknown().optional(),
    })).min(1).max(20),
  }),
  safety_config: safetyConfigSchema.partial().default({}),
  risks: z.array(z.string().max(300)).max(20).default([]),
  test_plan: z.array(z.string().max(400)).max(20).default([]),
});

function fieldCatalogBlock(): string {
  const fields = Object.entries(FILTER_FIELDS)
    .map(([k, d]) => `${k} (${d.kind}${d.enumValues ? `: ${d.enumValues.join("|")}` : ""})`)
    .join("; ");
  return `Available fields: ${fields}. Custom lead fields can be referenced as meta.<key> (text). Operators: ${FILTER_OPERATORS.join(", ")}.`;
}

const SYSTEM_PROMPT = `You translate a plain-English request into a WEBEE workspace People view or campaign filter definition.
Return ONLY a JSON object: {"name","description","object_type","filter_config":{"logic","conditions":[{"field","operator","value"}]},"safety_config":{},"risks":[],"test_plan":[]}.
object_type: "people_view" for browsing/segmenting people in the UI; "campaign_filter" when the user wants to control which leads a calling campaign targets.
Never invent fields not in the catalog (custom fields must be meta.<key>). Keep conditions minimal and faithful to the request. Never include credentials.`;

// ── Draft generation (called from SystemMind chat / build surfaces) ─────────
export async function generatePeopleViewDraftServer(args: {
  workspaceId: string;
  userId: string | null;
  description: string;
  objectType?: "people_view" | "campaign_filter" | null;
  instructedBy?: string;
}) {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const runId = await createRun(sb, workspaceId, userId, instructedBy, "people_view_generation", description);

  try {
    const routed = await routeGenerate({
      system: SYSTEM_PROMPT,
      user: `${fieldCatalogBlock()}\n\n${args.objectType ? `The user wants a ${args.objectType.replace("_", " ")}.` : ""}\nUser request:\n"${description.slice(0, 3000)}"\n\nProduce the JSON now.`,
      maxTokens: 2000,
      ...routedArgs(workspaceId, sb),
    });

    const parsed = DraftSchema.parse(parseModelJson(routed.text));
    if (args.objectType) parsed.object_type = args.objectType;

    // Hard validation against the filter engine registry — unknown fields
    // (other than meta.*) refuse the draft.
    const validated = validateFilterConfig(parsed.filter_config);
    if (!validated.ok || !validated.config) {
      throw new Error(`Generated filter is invalid: ${validated.errors.join("; ")}`);
    }
    const safety = safetyConfigSchema.parse({ ...DEFAULT_SAFETY, ...parsed.safety_config });

    // Dry-run NOW so the approver sees real numbers before approving.
    const dryRun = await runFilterDryRun(supabaseAdmin as any, workspaceId, validated.config, {
      mode: parsed.object_type === "campaign_filter" ? "campaign" : "view",
      safety,
    });

    const payload = {
      kind: parsed.object_type,
      name: parsed.name,
      purpose: parsed.description,
      filter_config: validated.config,
      safety_config: safety,
      dry_run: dryRun,
      unknown_fields: validated.unknownFields,
      risks: parsed.risks,
    };

    const riskLevel = parsed.object_type === "campaign_filter"
      ? (dryRun.riskLevel === "high" ? "high" : "medium")
      : "low";
    const riskReasons = [
      ...(parsed.object_type === "campaign_filter"
        ? ["Controls which leads an automated calling campaign will dial"]
        : ["Read-only saved view — does not modify data or trigger calls"]),
      ...dryRun.warnings,
    ];

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id: workspaceId,
      run_id: runId,
      created_by_user_id: userId,
      source: "systemmind",
      instructed_by: instructedBy,
      action_kind: parsed.object_type,
      title: parsed.name,
      purpose: parsed.description || `SystemMind-generated ${parsed.object_type.replace("_", " ")}`,
      payload,
      required_credentials: [],
      test_plan: parsed.test_plan.length > 0 ? parsed.test_plan : [
        `Dry-run matched ${dryRun.totalMatching} record(s) at draft time — re-check after approval.`,
      ],
      risk_level: riskLevel,
      risk_reasons: riskReasons,
      approval_required: true,
      status: "draft",
      model_provider: routed.provider,
      model_id: routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    await completeRun(sb, workspaceId, runId, routed);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_generated_action",
      targetId: draftRow.id,
      proposedAfterState: {
        kind: parsed.object_type, title: parsed.name, risk_level: riskLevel,
        status: "draft", dry_run_total: dryRun.totalMatching, model: routed.model,
      },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId: draftRow.id as string,
      draft: draftRow,
      dryRun,
      modelUsed: routed.model,
      provider: routed.provider,
      usedFallback: routed.usedFallback,
      riskLevel,
    };
  } catch (err) {
    await failRun(sb, workspaceId, runId, err);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_run",
      targetId: runId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Activation (dispatched from activateSystemMindAutomation) ───────────────
async function loadHubPayload(sb: Sb, workspaceId: string, generatedActionId: string) {
  const { data: draft, error } = await sb
    .from("systemmind_generated_actions")
    .select("id, payload, title, purpose, created_by_user_id")
    .eq("id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !draft) throw new Error("Draft not found for activation.");
  const payload = draft.payload ?? {};
  const validated = validateFilterConfig(payload.filter_config);
  if (!validated.ok || !validated.config) {
    throw new Error(`Stored filter failed re-validation at activation: ${validated.errors.join("; ")}`);
  }
  const safety = safetyConfigSchema.safeParse(payload.safety_config ?? {});
  return {
    draft,
    name: String(payload.name ?? draft.title).slice(0, 120),
    description: String(payload.purpose ?? draft.purpose ?? "").slice(0, 2000) || null,
    filterConfig: validated.config,
    safetyConfig: safety.success ? safety.data : DEFAULT_SAFETY,
  };
}

export async function activatePeopleViewKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const p = await loadHubPayload(sb, workspaceId, generatedActionId);

  const view = await createPeopleView({
    workspaceId,
    userId: p.draft.created_by_user_id ?? null,
    role: "owner", // approval already granted via HiveMind pipeline
    name: p.name,
    description: p.description,
    filterConfig: p.filterConfig,
    status: "draft",
    createdBySystemMind: true,
  });
  // Activate through the CRUD layer so versioning + audit apply.
  await updatePeopleView({
    workspaceId,
    userId: p.draft.created_by_user_id ?? null,
    role: "owner",
    id: view.id,
    patch: { status: "active" },
  });

  return {
    activatedTargetType: "workspace_people_view",
    activatedTargetId: view.id as string,
    summary: { name: p.name, conditions: p.filterConfig.conditions.length },
  };
}

export async function activateCampaignFilterKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const p = await loadHubPayload(sb, workspaceId, generatedActionId);

  const filter = await createCampaignFilter({
    workspaceId,
    userId: p.draft.created_by_user_id ?? null,
    role: "owner",
    name: p.name,
    description: p.description,
    filterConfig: p.filterConfig,
    safetyConfig: p.safetyConfig,
    status: "draft",
    createdBySystemMind: true,
  });
  await updateCampaignFilter({
    workspaceId,
    userId: p.draft.created_by_user_id ?? null,
    role: "owner",
    id: filter.id,
    patch: { status: "active" },
  });

  return {
    activatedTargetType: "workspace_campaign_filter",
    activatedTargetId: filter.id as string,
    summary: { name: p.name, conditions: p.filterConfig.conditions.length },
  };
}

// Re-export for convenience in SystemMind surfaces that convert an approved
// view into a campaign filter.
export { convertViewToCampaignFilter };
