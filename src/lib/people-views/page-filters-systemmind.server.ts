// ── SystemMind Page-Filter kind — server-only ───────────────────────────────
// Lets SystemMind draft workspace-scoped page filters (saved filters on major
// pages) via the Automation Layer hub (systemmind_generated_actions). Hub-only
// kind. Lifecycle: draft → pending_approval → active, activated ONLY from
// activateSystemMindAutomation.
//
// Safety invariants (do not weaken):
//   • workspace_id comes ONLY from server context.
//   • Filter configs are validated against the page's dataset registry BEFORE
//     storing the draft; unknown fields fail the draft.
//   • A read-only dry-run runs at draft time and is stored in the payload.
//   • Activation re-validates and creates the filter via the standard CRUD
//     layer (versioned + audited) — never raw inserts.
//   • Page filters are read-only views over data — they never call or message.

import { z } from "zod";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import {
  PAGE_DATASETS,
  PAGE_KEYS,
  FILTER_OPERATORS,
  validateFilterConfig,
  runPageFilterDryRun,
  type PageKey,
} from "./filter-engine.server";
import { createPageFilter, updatePageFilter } from "./page-filters.server";

type Sb = any;

async function createRun(sb: Sb, workspaceId: string, userId: string | null, instructedBy: string, description: string): Promise<string> {
  const { data, error } = await sb.from("systemmind_runs").insert({
    workspace_id: workspaceId,
    created_by_user_id: userId,
    instructed_by: instructedBy,
    run_type: "page_filter_generation",
    input_description: description.slice(0, 4000),
    status: "running",
  }).select("id").single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data.id as string;
}

async function completeRun(sb: Sb, workspaceId: string, runId: string, routed: any): Promise<void> {
  await sb.from("systemmind_runs").update({
    status: "completed",
    model_provider: routed?.provider ?? null,
    model_id: routed?.model ?? null,
    used_fallback: routed?.usedFallback ?? false,
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

const DraftSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).default(""),
  page_key: z.enum(PAGE_KEYS as [PageKey, ...PageKey[]]),
  filter_config: z.object({
    logic: z.enum(["and"]).default("and"),
    conditions: z.array(z.object({
      field: z.string().min(1).max(120),
      operator: z.string().min(1).max(40),
      value: z.unknown().optional(),
    })).min(1).max(20),
  }),
  sort_config: z.object({ field: z.string().max(120), direction: z.enum(["asc", "desc"]) }).partial().default({}),
  risks: z.array(z.string().max(300)).max(20).default([]),
  test_plan: z.array(z.string().max(400)).max(20).default([]),
});

function pageCatalogBlock(pageKey?: PageKey | null): string {
  const keys = pageKey ? [pageKey] : (PAGE_KEYS as PageKey[]);
  const blocks = keys.map((k) => {
    const ds = PAGE_DATASETS[k];
    const fields = Object.entries(ds.registry)
      .map(([key, d]) => `${key} (${d.kind}${d.enumValues ? `: ${d.enumValues.join("|")}` : ""})`)
      .join("; ");
    return `Page "${k}" fields: ${fields}${ds.allowMeta ? " — custom fields as meta.<key> (text)" : ""}.`;
  });
  return `${blocks.join("\n")}\nOperators: ${FILTER_OPERATORS.join(", ")}.`;
}

const SYSTEM_PROMPT = `You translate a plain-English request into a WEBEE saved page filter definition (a read-only saved filter shown on a workspace page).
Return ONLY a JSON object: {"name","description","page_key","filter_config":{"logic","conditions":[{"field","operator","value"}]},"sort_config":{},"risks":[],"test_plan":[]}.
Pick the page_key that matches the user's intent (calls page for call filters, campaigns for campaign filters, leads/people/qualified for lead filters, etc).
Never invent fields not in that page's catalog. Keep conditions minimal and faithful to the request. Never include credentials. Page filters NEVER call, message or modify data.`;

export async function generatePageFilterDraftServer(args: {
  workspaceId: string;
  userId: string | null;
  description: string;
  pageKey?: PageKey | null;
  instructedBy?: string;
}) {
  assertNotWbahWorkspace(args.workspaceId);
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const runId = await createRun(sb, workspaceId, userId, instructedBy, description);

  try {
    const routed = await routeGenerate({
      system: SYSTEM_PROMPT,
      user: `${pageCatalogBlock(args.pageKey)}\n\n${args.pageKey ? `The filter is for the "${args.pageKey}" page.` : ""}\nUser request:\n"${description.slice(0, 3000)}"\n\nProduce the JSON now.`,
      maxTokens: 2000,
      ...routedArgs(workspaceId, sb),
    });

    const parsed = DraftSchema.parse(parseModelJson(routed.text));
    if (args.pageKey) parsed.page_key = args.pageKey;

    const ds = PAGE_DATASETS[parsed.page_key];
    const validated = validateFilterConfig(parsed.filter_config, {
      registry: ds.registry,
      allowMeta: ds.allowMeta,
    });
    if (!validated.ok || !validated.config) {
      throw new Error(`Generated filter is invalid: ${validated.errors.join("; ")}`);
    }

    // Read-only dry-run NOW so the approver sees real counts.
    const dryRun = await runPageFilterDryRun(sb, workspaceId, parsed.page_key, validated.config);

    const payload = {
      kind: "page_filter",
      page_key: parsed.page_key,
      name: parsed.name,
      purpose: parsed.description,
      filter_config: validated.config,
      sort_config: parsed.sort_config,
      dry_run: dryRun,
      unknown_fields: validated.unknownFields,
      risks: parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id: workspaceId,
      run_id: runId,
      created_by_user_id: userId,
      source: "systemmind",
      instructed_by: instructedBy,
      action_kind: "page_filter",
      title: parsed.name,
      purpose: parsed.description || `SystemMind-generated page filter for ${parsed.page_key}`,
      payload,
      required_credentials: [],
      test_plan: parsed.test_plan.length > 0 ? parsed.test_plan : [
        `Dry-run matched ${dryRun.totalMatching} record(s) at draft time — re-check after approval.`,
      ],
      risk_level: "low",
      risk_reasons: [
        "Read-only saved page filter — does not modify data or trigger calls",
        ...dryRun.warnings,
      ],
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
        kind: "page_filter", page_key: parsed.page_key, title: parsed.name,
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
      riskLevel: "low" as const,
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
export async function activatePageFilterKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: draft, error } = await sb
    .from("systemmind_generated_actions")
    .select("id, payload, title, purpose, created_by_user_id")
    .eq("id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .single();
  if (error || !draft) throw new Error("Draft not found for activation.");

  const payload = draft.payload ?? {};
  const pageKey = String(payload.page_key ?? "") as PageKey;
  if (!PAGE_KEYS.includes(pageKey)) throw new Error(`Draft has invalid page_key "${pageKey}".`);
  const ds = PAGE_DATASETS[pageKey];
  const validated = validateFilterConfig(payload.filter_config, {
    registry: ds.registry,
    allowMeta: ds.allowMeta,
  });
  if (!validated.ok || !validated.config) {
  assertNotWbahWorkspace(workspaceId);
    throw new Error(`Stored filter failed re-validation at activation: ${validated.errors.join("; ")}`);
  }

  const filter = await createPageFilter({
    workspaceId,
    userId: draft.created_by_user_id ?? null,
    role: "owner", // approval already granted via HiveMind pipeline
    pageKey,
    name: String(payload.name ?? draft.title).slice(0, 120),
    description: String(payload.purpose ?? draft.purpose ?? "").slice(0, 2000) || null,
    filterConfig: validated.config,
    sortConfig: payload.sort_config ?? {},
    status: "draft",
    createdBySystemMind: true,
  });
  // Activate through the CRUD layer so versioning + audit apply.
  await updatePageFilter({
    workspaceId,
    userId: draft.created_by_user_id ?? null,
    role: "owner",
    id: filter.id,
    patch: { status: "active" },
  });

  return {
    activatedTargetType: "workspace_page_filter",
    activatedTargetId: filter.id as string,
    summary: { name: filter.name, page_key: pageKey, conditions: validated.config.conditions.length },
  };
}
