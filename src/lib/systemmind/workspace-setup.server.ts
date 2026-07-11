// ── SystemMind Workspace Setup — onboarding assistant + health checks ─────────
// Two capabilities riding on the SystemMind Automation Layer:
//
//   1. Onboarding assistant — SystemMind drafts a per-workspace setup checklist
//      tailored to the stated business (action_kind = "onboarding_plan" on the
//      systemmind_generated_actions hub, approval-first). Once activated, the
//      checklist lives in workspace_setup_checklists and completion is DERIVED:
//      every read re-runs the deterministic check for each item — stored
//      checkmarks are never trusted.
//
//   2. Health-check engine — an on-demand, fully deterministic scan producing a
//      scored report (workspace_health_runs). Findings become RECOMMENDED draft
//      actions (pending hivemind_actions rows) that a human must approve —
//      SystemMind never auto-fixes anything.
//
// Safety invariants:
//   • workspace_id comes ONLY from server context.
//   • check_key values are whitelisted; the model can only pick from
//     CHECK_REGISTRY — it cannot invent executable checks.
//   • Health checks are read-only; proposed fixes go through the HiveMind
//     approval pipeline as create_task actions (deduped against pending ones).
//   • Every generation/activation/health-run writes a systemmind_audit_logs row.

import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
} from "@/lib/systemmind/systemmind-automation.server";
import { assertNoCredentialValues } from "@/lib/systemmind/systemmind-generators.server";

type Sb = any;

// ═══════════════════════════════════════════════════════════════════════════
// Deterministic check registry — the ONLY checks an onboarding item may bind
// to, and the backbone of the health-check engine.
// ═══════════════════════════════════════════════════════════════════════════

export interface CheckMeta {
  key:         string;
  label:       string;
  description: string;
  href:        string;
  /** weight in the health score (higher = more important) */
  weight:      number;
  category:    "core" | "channels" | "knowledge" | "growth" | "operations";
}

interface CheckContext {
  sb:         Sb;
  workspaceId: string;
  settings:   any;
}

async function exists(sb: Sb, table: string, build: (q: any) => any): Promise<boolean> {
  try {
    const { count, error } = await build(
      sb.from(table).select("id", { count: "exact", head: true }),
    );
    if (error) return false;
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}

export const CHECK_REGISTRY: Record<string, CheckMeta & {
  run: (ctx: CheckContext) => Promise<boolean>;
}> = {
  business_dna_completed: {
    key: "business_dna_completed", label: "Complete Business DNA", weight: 3, category: "core",
    description: "Business profile (industry, customers, goals) captured so AI executives have context.",
    href: "/growthmind/business-dna",
    run: (c) => exists(c.sb, "growthmind_business_dna", (q) => q.eq("workspace_id", c.workspaceId)),
  },
  first_agent_created: {
    key: "first_agent_created", label: "Create your first AI agent", weight: 3, category: "core",
    description: "At least one AI agent exists in the builder.",
    href: "/builder",
    run: (c) => exists(c.sb, "agents", (q) => q.eq("workspace_id", c.workspaceId)),
  },
  voice_provider_connected: {
    key: "voice_provider_connected", label: "Connect a voice provider", weight: 3, category: "channels",
    description: "Retell workspace or ElevenLabs key configured so voice agents can run.",
    href: "/settings",
    run: async (c) => !!(c.settings?.retell_workspace_id || c.settings?.retell_default_agent_id || c.settings?.elevenlabs_api_key || process.env.RETELL_API_KEY),
  },
  telephony_connected: {
    key: "telephony_connected", label: "Configure telephony", weight: 2, category: "channels",
    description: "Twilio credentials present so calls can be placed/received.",
    href: "/settings",
    run: async (c) => !!(c.settings?.twilio_auth_token),
  },
  whatsapp_connected: {
    key: "whatsapp_connected", label: "Connect WhatsApp", weight: 1, category: "channels",
    description: "A WhatsApp provider (Meta/WATI/Twilio) is configured.",
    href: "/settings",
    run: async (c) => !!(c.settings?.whatsapp_phone_id || c.settings?.meta_phone_number_id),
  },
  email_provider_connected: {
    key: "email_provider_connected", label: "Connect an email provider", weight: 1, category: "channels",
    description: "HexMail sending provider (SendGrid/Resend/Postmark) configured for campaigns.",
    href: "/settings",
    run: async (c) => !!(c.settings?.hexmail_sendgrid_api_key || c.settings?.hexmail_resend_api_key || c.settings?.hexmail_postmark_server_token),
  },
  calendar_connected: {
    key: "calendar_connected", label: "Connect Cal.com", weight: 1, category: "channels",
    description: "Cal.com API key present so agents can book appointments.",
    href: "/settings",
    run: async (c) => !!(c.settings?.calcom_api_key || c.settings?.calcom_api_token),
  },
  knowledge_uploaded: {
    key: "knowledge_uploaded", label: "Upload business knowledge", weight: 2, category: "knowledge",
    description: "At least one document uploaded to an executive knowledge base.",
    href: "/knowledge-centre",
    run: async (c) => {
      const { data: kbs } = await c.sb.from("executive_knowledge_bases").select("id")
        .eq("workspace_id", c.workspaceId).limit(20);
      for (const kb of kbs ?? []) {
        if (await exists(c.sb, "executive_documents", (q) => q.eq("kb_id", kb.id))) return true;
      }
      return false;
    },
  },
  first_lead_captured: {
    key: "first_lead_captured", label: "Capture your first lead", weight: 2, category: "growth",
    description: "At least one lead exists in the CRM (webform, import, or agent call).",
    href: "/leads",
    run: (c) => exists(c.sb, "leads", (q) => q.eq("workspace_id", c.workspaceId)),
  },
  first_call_completed: {
    key: "first_call_completed", label: "Complete your first AI call", weight: 2, category: "operations",
    description: "At least one AI agent call has been recorded.",
    href: "/dashboard",
    run: (c) => exists(c.sb, "calls", (q) => q.eq("workspace_id", c.workspaceId)),
  },
  first_campaign_created: {
    key: "first_campaign_created", label: "Create a follow-up campaign", weight: 1, category: "growth",
    description: "An email/follow-up campaign exists (draft or active).",
    href: "/growthmind/campaign-factory",
    run: (c) => exists(c.sb, "hexmail_campaigns", (q) => q.eq("workspace_id", c.workspaceId)),
  },
  crm_connected: {
    key: "crm_connected", label: "Connect a CRM", weight: 1, category: "operations",
    description: "HubSpot or GoHighLevel connected for lead syncing.",
    href: "/settings",
    run: async (c) => !!(c.settings?.hubspot_api_key || c.settings?.ghl_api_key),
  },
  accountsmind_config_active: {
    key: "accountsmind_config_active", label: "Set up AccountsMind dashboards", weight: 1, category: "operations",
    description: "Custom AccountsMind stats/widgets have been configured for this workspace.",
    href: "/systemmind/accountsmind-setup",
    run: async (c) => {
      if (await exists(c.sb, "accountsmind_widget_defs", (q) => q.eq("workspace_id", c.workspaceId).eq("status", "active").eq("is_deleted", false))) return true;
      return exists(c.sb, "accountsmind_stat_defs", (q) => q.eq("workspace_id", c.workspaceId).eq("status", "active").eq("is_deleted", false));
    },
  },
  business_hours_set: {
    key: "business_hours_set", label: "Set business name & hours", weight: 1, category: "core",
    description: "Workspace business name and timezone/hours configured.",
    href: "/settings",
    run: async (c) => !!(c.settings?.business_name),
  },
};

export const CHECK_KEYS = Object.keys(CHECK_REGISTRY);

async function buildCheckContext(workspaceId: string): Promise<CheckContext> {
  const sb = supabaseAdmin as any;
  const { data: settings } = await sb.from("workspace_settings").select("*")
    .eq("workspace_id", workspaceId).maybeSingle();
  return { sb, workspaceId, settings: settings ?? {} };
}

export async function runChecksServer(
  workspaceId: string,
  keys: string[],
): Promise<Record<string, boolean>> {
  const ctx = await buildCheckContext(workspaceId);
  const out: Record<string, boolean> = {};
  const unique = [...new Set(keys)].filter((k) => CHECK_REGISTRY[k]);
  await Promise.all(unique.map(async (k) => {
    try {
      out[k] = await CHECK_REGISTRY[k].run(ctx);
    } catch {
      out[k] = false;
    }
  }));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// Onboarding plan generation (draft on the automation hub)
// ═══════════════════════════════════════════════════════════════════════════

const ChecklistItemSchema = z.object({
  check_key: z.string().max(80),
  title:     z.string().min(1).max(200),
  why:       z.string().max(500).default(""),
});

const GeneratedPlanSchema = z.object({
  name:             z.string().min(1).max(200),
  business_summary: z.string().max(1500).default(""),
  items:            z.array(ChecklistItemSchema).min(1).max(20),
  risks:            z.array(z.string().max(300)).max(10).default([]),
  test_plan:        z.array(z.string().max(400)).max(10).default([]),
});

export type GeneratedPlan = z.infer<typeof GeneratedPlanSchema>;

function sanitizePlan(plan: GeneratedPlan): GeneratedPlan {
  const seen = new Set<string>();
  const items = plan.items.filter((i) => {
    if (!CHECK_REGISTRY[i.check_key]) return false;
    if (seen.has(i.check_key)) return false;
    seen.add(i.check_key);
    return true;
  });
  return { ...plan, items };
}

function buildPlanSystemPrompt(): string {
  const checkList = Object.values(CHECK_REGISTRY)
    .map((c) => `- ${c.key} — ${c.label}: ${c.description}`)
    .join("\n");
  return `You are SystemMind, the AI CTO of the WEBEE platform. You design a WORKSPACE setup checklist tailored to a business description. You NEVER execute anything — a human approves the plan first.

AVAILABLE CHECKLIST STEPS (items may ONLY use these check_key values — completion is verified automatically against real system state, so never invent keys):
${checkList}

RULES:
- Pick 5–12 steps that genuinely matter for THIS business, ordered by priority.
- "title" may be tailored wording; "why" explains the value for this specific business in 1–2 sentences.
- NEVER include credentials or secrets.
- risks: anything the user should know. test_plan: 2–4 verification steps.

Return ONLY valid JSON:
{
  "name": "...",
  "business_summary": "...",
  "items": [ { "check_key": "first_agent_created", "title": "...", "why": "..." } ],
  "risks": ["..."],
  "test_plan": ["..."]
}`;
}

export async function generateOnboardingPlanServer(args: {
  workspaceId:   string;
  userId:        string | null;
  description:   string;
  instructedBy?: "user" | "hivemind" | "admin";
}): Promise<{
  runId: string;
  draftId: string;
  draft: Record<string, any>;
  modelUsed: string;
  provider: string;
  usedFallback: boolean;
  claudeEnabled: boolean;
}> {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const { data: run, error: runErr } = await sb.from("systemmind_runs").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    instructed_by:      instructedBy,
    run_type:           "onboarding_plan_generation",
    input_description:  description.slice(0, 4000),
    status:             "running",
  }).select("id").single();
  if (runErr) throw new Error(`Failed to create run: ${runErr.message}`);
  const runId = run.id as string;

  const claudeEnabled = isClaudeEnabled();

  try {
    // Give the model the CURRENT derived state so the plan prioritises gaps.
    const currentState = await runChecksServer(workspaceId, CHECK_KEYS);
    const stateSummary = Object.entries(currentState)
      .map(([k, v]) => `${k}: ${v ? "DONE" : "not done"}`).join("\n");

    const routed = await routeGenerate({
      system:      buildPlanSystemPrompt(),
      user:        `Business description:\n"${description.slice(0, 3000)}"\n\nCurrent verified workspace state:\n${stateSummary}\n\nDesign the setup checklist. Strict JSON, whitelisted check_key values only.`,
      contentType: "systemmind_onboarding_plan",
      maxTokens:   3000,
      mode:        "manual",
      provider:    claudeEnabled ? "claude" : "openai",
      model:       claudeEnabled ? "claude-sonnet-4-5" : "gpt-4.1",
      settings:    {},
      workspaceId,
      sb,
    });

    let rawJson: unknown;
    try {
      const cleaned = routed.text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
      rawJson = JSON.parse(cleaned);
    } catch {
      throw new Error("Model returned invalid JSON — try again or rephrase the request.");
    }
    let parsed = GeneratedPlanSchema.parse(rawJson);
    parsed = sanitizePlan(parsed);
    assertNoCredentialValues(parsed, "Onboarding plan");
    if (parsed.items.length === 0) throw new Error("Generated plan had no valid steps after safety filtering.");

    const payload = {
      name:             parsed.name,
      business_summary: parsed.business_summary,
      items:            parsed.items,
      risks:            parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "onboarding_plan",
      title:                parsed.name,
      purpose:              parsed.business_summary || `Setup plan (${parsed.items.length} steps)`,
      payload,
      required_credentials: [],
      test_plan:            parsed.test_plan,
      risk_level:           "low",
      risk_reasons:         [],
      approval_required:    true,
      status:               "draft",
      model_provider:       routed.provider,
      model_id:             routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    await sb.from("systemmind_runs").update({
      status: "completed",
      model_provider: routed.provider,
      model_id: routed.model,
      used_fallback: routed.usedFallback,
      fallback_from: routed.fallbackFrom,
      input_tokens: routed.inputTokens,
      output_tokens: routed.outputTokens,
      cost_usd: routed.costUsd,
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);

    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_onboarding_plan_draft",
      targetType: "systemmind_generated_action",
      targetId:   draftRow.id,
      proposedAfterState: { title: parsed.name, items: parsed.items.length, status: "draft", model: routed.model },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId: draftRow.id,
      draft: draftRow,
      modelUsed: routed.model,
      provider: routed.provider,
      usedFallback: routed.usedFallback,
      claudeEnabled,
    };
  } catch (err: any) {
    await sb.from("systemmind_runs").update({
      status: "failed",
      error: (err?.message ?? String(err)).slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).eq("id", runId).eq("workspace_id", workspaceId);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_onboarding_plan_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err?.message ?? String(err),
    });
    throw err;
  }
}

// ── Activation (called ONLY from activateSystemMindAutomation kind dispatch) ──
export async function activateOnboardingPlanKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: draft, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("Draft not found in this workspace.");

  const payload = draft.payload ?? {};
  let plan = GeneratedPlanSchema.parse({
    name:             payload.name ?? draft.title,
    business_summary: payload.business_summary ?? "",
    items:            payload.items ?? [],
    risks:            payload.risks ?? [],
    test_plan:        [],
  });
  plan = sanitizePlan(plan);
  assertNoCredentialValues(plan, "Onboarding plan");
  if (plan.items.length === 0) throw new Error("Plan payload failed safety re-validation — activation refused.");

  // Version chain: archive the current active checklist (if any).
  const { data: existing } = await sb.from("workspace_setup_checklists")
    .select("id, version")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("is_deleted", false)
    .maybeSingle();

  let version = 1;
  let previousVersionId: string | null = null;
  if (existing) {
    version = (existing.version ?? 1) + 1;
    previousVersionId = existing.id;
    await sb.from("workspace_setup_checklists").update({ status: "archived" })
      .eq("id", existing.id).eq("workspace_id", workspaceId);
  }

  const items = plan.items.map((i, idx) => ({
    check_key: i.check_key,
    title:     i.title,
    why:       i.why,
    href:      CHECK_REGISTRY[i.check_key]?.href ?? "/settings",
    order:     idx,
  }));

  const { data: inserted, error: insErr } = await sb.from("workspace_setup_checklists").insert({
    workspace_id:        workspaceId,
    created_by_user_id:  draft.created_by_user_id ?? null,
    created_by_system:   "systemmind",
    source_draft_id:     generatedActionId,
    title:               plan.name,
    business_summary:    plan.business_summary || null,
    items,
    status:              "active",
    version,
    previous_version_id: previousVersionId,
  }).select("id").single();
  if (insErr) throw new Error(`Failed to create checklist: ${insErr.message}`);

  return {
    activatedTargetType: "workspace_setup_checklist",
    activatedTargetId:   inserted.id,
    summary: { checklist_items: items.length, version },
  };
}

// ── Derived checklist read (re-checks, never trusts stored state) ─────────────
export async function getSetupChecklistServer(workspaceId: string): Promise<{
  checklist: Record<string, any> | null;
  items: Array<Record<string, any>>;
  doneCount: number;
  totalCount: number;
}> {
  const sb = supabaseAdmin as any;
  const { data: checklist, error } = await sb.from("workspace_setup_checklists")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!checklist) return { checklist: null, items: [], doneCount: 0, totalCount: 0 };

  const rawItems: any[] = Array.isArray(checklist.items) ? checklist.items : [];
  const keys = rawItems.map((i) => i.check_key);
  const results = await runChecksServer(workspaceId, keys);

  const items = rawItems.map((i) => ({
    ...i,
    done: results[i.check_key] === true,
  }));
  const doneCount = items.filter((i) => i.done).length;

  return { checklist, items, doneCount, totalCount: items.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// Health-check engine (deterministic, on-demand, scored)
// ═══════════════════════════════════════════════════════════════════════════

export interface HealthFinding {
  check_key:   string;
  label:       string;
  passed:      boolean;
  weight:      number;
  category:    string;
  detail:      string;
  href:        string;
  recommended: boolean;
}

export async function runWorkspaceHealthCheckServer(
  workspaceId: string,
  userId: string | null,
): Promise<{
  runId: string;
  score: number;
  maxScore: number;
  percent: number;
  findings: HealthFinding[];
  proposedActionIds: string[];
}> {
  const sb = supabaseAdmin as any;
  if (!workspaceId) throw new Error("workspace_id missing — refusing to run health check.");

  const { data: run, error: runErr } = await sb.from("workspace_health_runs").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    created_by_system:  "systemmind",
    status:             "running",
  }).select("id").single();
  if (runErr) throw new Error(`Failed to create health run: ${runErr.message}`);
  const runId = run.id as string;

  try {
    const results = await runChecksServer(workspaceId, CHECK_KEYS);

    // Best-effort: capture today's AccountsMind metric snapshots on every
    // health-check run so trend widgets accumulate history (never throws).
    try {
      const { snapshotActiveConfigMetricsServer } = await import(
        "@/lib/accountsmind/accountsmind-config.server"
      );
      await snapshotActiveConfigMetricsServer(workspaceId);
    } catch {
      // snapshot failures must never fail a health run
    }

    const findings: HealthFinding[] = Object.values(CHECK_REGISTRY).map((c) => {
      const passed = results[c.key] === true;
      return {
        check_key:   c.key,
        label:       c.label,
        passed,
        weight:      c.weight,
        category:    c.category,
        detail:      c.description,
        href:        c.href,
        recommended: !passed && c.weight >= 2,
      };
    });

    const maxScore = findings.reduce((a, f) => a + f.weight, 0);
    const score    = findings.filter((f) => f.passed).reduce((a, f) => a + f.weight, 0);
    const percent  = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

    // Findings → RECOMMENDED draft actions (pending approval; never auto-fix).
    // Dedupe against pending actions with the same fingerprint.
    const { data: pending } = await sb.from("hivemind_actions")
      .select("id, action_payload")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .eq("action_type", "create_task");
    const pendingKeys = new Set(
      (pending ?? []).map((a: any) => a.action_payload?.health_check_key).filter(Boolean),
    );

    const proposedActionIds: string[] = [];
    for (const f of findings.filter((x) => x.recommended)) {
      if (pendingKeys.has(f.check_key)) continue;
      const { data: action, error: actErr } = await sb.from("hivemind_actions").insert({
        workspace_id:   workspaceId,
        title:          `Health check: ${f.label}`,
        description:    `${f.detail}\n\nProposed by the SystemMind health check (score ${percent}%). Approving creates an ops task — nothing is changed automatically.`,
        action_type:    "create_task",
        action_payload: {
          title:            f.label,
          description:      `${f.detail} (Go to ${f.href})`,
          priority:         f.weight >= 3 ? "high" : "medium",
          health_check_key: f.check_key,
          health_run_id:    runId,
        },
        status:      "pending",
        proposed_by: "systemmind",
      }).select("id").single();
      if (!actErr && action) proposedActionIds.push(action.id as string);
    }

    const summary = `Score ${score}/${maxScore} (${percent}%). ${findings.filter((f) => !f.passed).length} of ${findings.length} checks failing; ${proposedActionIds.length} new recommended actions proposed.`;

    const { error: upErr } = await sb.from("workspace_health_runs").update({
      status:              "complete",
      score,
      max_score:           maxScore,
      findings,
      summary,
      proposed_action_ids: proposedActionIds,
    }).eq("id", runId).eq("workspace_id", workspaceId);
    if (upErr) throw new Error(upErr.message);

    await writeSystemMindAudit({
      workspaceId, userId,
      actionType: "run_health_check",
      targetType: "workspace_health_run",
      targetId:   runId,
      finalAfterState: { score, max_score: maxScore, percent, proposed_actions: proposedActionIds.length },
      executedAt: new Date().toISOString(),
    });

    return { runId, score, maxScore, percent, findings, proposedActionIds };
  } catch (err: any) {
    await sb.from("workspace_health_runs").update({
      status: "failed",
      error:  (err?.message ?? String(err)).slice(0, 2000),
    }).eq("id", runId).eq("workspace_id", workspaceId);
    await writeSystemMindAudit({
      workspaceId, userId,
      actionType: "run_health_check",
      targetType: "workspace_health_run",
      targetId:   runId,
      error:      err?.message ?? String(err),
    });
    throw err;
  }
}

export async function listHealthRunsServer(workspaceId: string): Promise<any[]> {
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("workspace_health_runs")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return data ?? [];
}
