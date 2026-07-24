// ── SystemMind Generators — server-only (Task: WhatsApp setup, follow-up
//    sequences, n8n→WEBEE conversion) ────────────────────────────────────────
// Three draft generators built on the SystemMind Automation Layer hub
// (systemmind_generated_actions). Hub-and-detail model: lifecycle status lives
// ONLY on the hub row; the detail tables (whatsapp_setup_drafts,
// follow_up_sequence_drafts, workflow_blueprints) hold kind-specific structure
// linked by generated_action_id.
//
// Safety invariants (same as the automation layer — do not weaken):
//   • workspace_id comes ONLY from server context.
//   • No credentials/secrets in prompts, drafts, or model output — credential
//     NAMES only; a defence-in-depth scrubber rejects credential-shaped values.
//   • Every generator writes a systemmind_runs row + audit log.
//   • Activation happens ONLY via the HiveMind approval pipeline (dispatched
//     from activateSystemMindAutomation by action_kind).
//   • n8n stays READ-ONLY: conversion reads stored snapshots, never the API.

import { z } from "zod";
import { randomUUID } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { routeGenerate } from "@/lib/growthmind/model-router.server";
import {
  writeSystemMindAudit,
  isClaudeEnabled,
  classifyDraftRisk,
  StepSchema,
  sanitizeGeneratedSteps,
  type GeneratedDraft,
} from "@/lib/systemmind/systemmind-automation.server";

// ═══════════════════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════════════════

type Sb = any;

const CommonTailSchema = {
  required_credentials: z.array(z.string().max(120)).max(20).default([]),
  risks:                z.array(z.string().max(300)).max(20).default([]),
  test_plan:            z.array(z.string().max(400)).max(20).default([]),
};

function parseModelJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error("Model returned invalid JSON — try again or rephrase the request.");
  }
}

// Defence-in-depth: reject drafts containing credential-shaped literals. The
// prompts forbid credentials, but if a model ever echoes something that looks
// like a real secret, refuse to store the draft at all.
const CREDENTIAL_VALUE_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/,            // OpenAI/Stripe-style secret keys
  /whsec_[A-Za-z0-9]{16,}/,           // webhook signing secrets
  /AC[0-9a-fA-F]{32}/,                // Twilio Account SID
  /SK[0-9a-fA-F]{32}/,                // Twilio API key SID
  /EAA[A-Za-z0-9]{40,}/,              // Meta long-lived access tokens
  /eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, // JWTs
  /sbp_[A-Za-z0-9]{20,}/,             // Supabase personal access tokens
  /key_[A-Za-z0-9]{24,}/,             // Retell API keys
  /Bearer\s+[A-Za-z0-9._-]{30,}/i,    // raw bearer tokens
];

export function assertNoCredentialValues(draft: unknown, label: string): void {
  const blob = JSON.stringify(draft ?? {});
  for (const re of CREDENTIAL_VALUE_PATTERNS) {
    if (re.test(blob)) {
      throw new Error(
        `${label} draft contained a credential-shaped value and was rejected. ` +
        `Credentials must never appear in drafts — only credential names.`,
      );
    }
  }
}

async function createRun(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  instructedBy: string,
  runType: string,
  description: string,
): Promise<string> {
  const { data, error } = await sb.from("systemmind_runs").insert({
    workspace_id:       workspaceId,
    created_by_user_id: userId,
    instructed_by:      instructedBy,
    run_type:           runType,
    input_description:  description.slice(0, 4000),
    status:             "running",
  }).select("id").single();
  if (error) throw new Error(`Failed to create run: ${error.message}`);
  return data.id as string;
}

async function completeRun(sb: Sb, workspaceId: string, runId: string, routed: {
  provider?: string; model?: string; usedFallback?: boolean; fallbackFrom?: string | null;
  inputTokens?: number | null; outputTokens?: number | null; costUsd?: number | null;
} | null): Promise<void> {
  await sb.from("systemmind_runs").update({
    status:         "completed",
    model_provider: routed?.provider ?? null,
    model_id:       routed?.model ?? null,
    used_fallback:  routed?.usedFallback ?? false,
    fallback_from:  routed?.fallbackFrom ?? null,
    input_tokens:   routed?.inputTokens ?? null,
    output_tokens:  routed?.outputTokens ?? null,
    cost_usd:       routed?.costUsd ?? null,
    completed_at:   new Date().toISOString(),
  }).eq("id", runId).eq("workspace_id", workspaceId);
}

async function failRun(sb: Sb, workspaceId: string, runId: string, err: unknown): Promise<void> {
  await sb.from("systemmind_runs").update({
    status:       "failed",
    error:        (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    completed_at: new Date().toISOString(),
  }).eq("id", runId).eq("workspace_id", workspaceId);
}

function routedArgs(workspaceId: string, sb: Sb) {
  const claudeEnabled = isClaudeEnabled();
  return {
    contentType: "systemmind_automation",
    mode:        "manual" as const,
    provider:    claudeEnabled ? ("claude" as const) : ("openai" as const),
    model:       claudeEnabled ? ("claude-sonnet-4-5" as const) : ("gpt-4.1" as const),
    settings:    {},
    workspaceId,
    sb,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. WhatsApp Setup Generator
// ═══════════════════════════════════════════════════════════════════════════

export type WhatsAppProvider = "twilio" | "wati" | "meta";

const WhatsAppSetupStepSchema = z.object({
  order:                z.number().int().min(1).max(30),
  title:                z.string().min(1).max(300),
  details:              z.string().max(2000).default(""),
  requires_credentials: z.boolean().default(false),
  credential_names:     z.array(z.string().max(120)).max(10).default([]),
});

const WhatsAppDraftSchema = z.object({
  name:    z.string().min(1).max(200),
  purpose: z.string().min(1).max(2000),
  setup_steps: z.array(WhatsAppSetupStepSchema).min(1).max(20),
  webhook_config: z.object({
    inbound_path: z.string().max(300).default(""),
    verify_hint:  z.string().max(500).default(""),
    notes:        z.string().max(1000).default(""),
  }).default({ inbound_path: "", verify_hint: "", notes: "" }),
  agent_binding: z.object({
    agent_id:   z.string().max(100).nullable().default(null),
    agent_name: z.string().max(200).nullable().default(null),
    notes:      z.string().max(1000).default(""),
  }).default({ agent_id: null, agent_name: null, notes: "" }),
  message_templates: z.array(z.object({
    name:      z.string().min(1).max(120),
    language:  z.string().max(20).default("en"),
    body:      z.string().min(1).max(2000),
    variables: z.array(z.string().max(60)).max(15).default([]),
  })).max(10).default([]),
  ...CommonTailSchema,
});

interface WhatsAppContext {
  currentProvider:   string | null;
  twilioConfigured:  boolean;
  watiConnected:     boolean;
  metaConfigured:    boolean;
  agents:            Array<{ id: string; name: string }>;
}

// Existence-only checks — never reads credential VALUES into the caller's flow.
async function gatherWhatsAppContext(sb: Sb, workspaceId: string): Promise<WhatsAppContext> {
  const [{ data: ws }, { data: watiRow }, { data: agentRows }] = await Promise.all([
    sb.from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token")
      .eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("wati_connections").select("status").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("agents").select("id, name, settings").eq("workspace_id", workspaceId).limit(200),
  ]);

  const agents = ((agentRows ?? []) as any[])
    .filter((a) => {
      try {
        const s = typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {});
        return s.channelType === "whatsapp";
      } catch { return false; }
    })
    .map((a) => ({ id: String(a.id), name: String(a.name ?? "Unnamed agent") }));

  return {
    currentProvider:  (ws?.whatsapp_provider as string | undefined)?.trim() || null,
    twilioConfigured: !!(ws?.twilio_account_sid?.trim() && ws?.twilio_auth_token?.trim() && ws?.whatsapp_phone_id?.trim()),
    watiConnected:    watiRow?.status === "connected",
    metaConfigured:   !!(ws?.meta_phone_number_id?.trim() && ws?.meta_access_token?.trim()),
    agents,
  };
}

function isProviderConfigured(ctx: WhatsAppContext, provider: string | null): boolean {
  if (provider === "twilio") return ctx.twilioConfigured;
  if (provider === "wati")   return ctx.watiConnected;
  if (provider === "meta")   return ctx.metaConfigured;
  return false;
}

// Real inbound webhook paths in this codebase — set deterministically, never
// trusted from the model.
function inboundPathFor(provider: WhatsAppProvider, workspaceId: string): string {
  if (provider === "wati") return "/api/webhook/wati-inbound";
  return `/api/public/whatsapp-webhook/${workspaceId}`;
}

const WHATSAPP_PROVIDER_NOTES: Record<WhatsAppProvider, string> = {
  twilio: `Twilio WhatsApp: needs Account SID, Auth Token and a WhatsApp-enabled phone number (stored in WEBEE's WhatsApp Settings — never in this draft). Inbound messages arrive via the WEBEE webhook URL configured in the Twilio console for the number.`,
  wati:   `WATI: needs the WATI API endpoint + access token saved through WEBEE's WATI connection screen (wati_connections). Inbound messages arrive via the WEBEE WATI webhook URL configured inside WATI.`,
  meta:   `Meta WhatsApp Cloud API: needs Phone Number ID, WABA ID and a permanent access token saved through WEBEE's Meta settings, plus a manual webhook verification step in the Meta App Dashboard (hub.challenge) pointing at the WEBEE webhook URL with the verify token shown in WEBEE.`,
};

const WHATSAPP_SYSTEM_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform. You produce a WhatsApp provider SETUP DRAFT for a workspace — a structured, human-executable setup plan. You NEVER execute anything and NEVER include credential values (no API keys, tokens, SIDs used as secrets, passwords). Name required credentials descriptively (e.g. "Twilio Auth Token") — values are entered by the human in WEBEE's settings screens only.

Return ONLY valid JSON:
{
  "name": "...",
  "purpose": "...",
  "setup_steps": [ { "order": 1, "title": "...", "details": "...", "requires_credentials": true|false, "credential_names": ["..."] } ],
  "webhook_config": { "inbound_path": "", "verify_hint": "...", "notes": "..." },
  "agent_binding": { "agent_id": "<one of the provided agent ids or null>", "agent_name": "...", "notes": "..." },
  "message_templates": [ { "name": "...", "language": "en", "body": "...", "variables": ["name"] } ],
  "required_credentials": ["..."],
  "risks": ["..."],
  "test_plan": ["..."]
}

RULES:
- setup_steps: 4–12 concrete ordered steps a human follows (WEBEE settings screens + the provider's own console). Mark steps that involve entering credentials with requires_credentials=true.
- message_templates: 1–5 practical starter templates for the described use case. Use {{variable}} placeholders. Keep bodies compliant with WhatsApp business messaging policy (no spam, clear opt-out where appropriate).
- agent_binding: pick the most suitable agent id from the provided list, or null if none fit.
- risks: real risks (messaging customers, provider switching implications, template approval delays for Meta).
- test_plan: 3–6 manual verification steps before real customer traffic.`;

export interface GenerateWhatsAppSetupArgs {
  workspaceId:   string;
  userId:        string | null;
  provider:      WhatsAppProvider;
  description:   string;
  instructedBy?: "user" | "hivemind" | "admin";
}

export async function generateWhatsAppSetupDraftServer(args: GenerateWhatsAppSetupArgs) {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, provider, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const runId = await createRun(sb, workspaceId, userId, instructedBy, "whatsapp_setup_generation", `[${provider}] ${description}`);

  try {
    const ctx = await gatherWhatsAppContext(sb, workspaceId);

    const contextBlock = [
      `Target provider: ${provider}`,
      `Provider notes: ${WHATSAPP_PROVIDER_NOTES[provider]}`,
      `Current workspace provider: ${ctx.currentProvider ?? "none configured"}`,
      `Twilio configured: ${ctx.twilioConfigured}; WATI connected: ${ctx.watiConnected}; Meta configured: ${ctx.metaConfigured}`,
      `Available WhatsApp agents (id — name): ${ctx.agents.length > 0 ? ctx.agents.map((a) => `${a.id} — ${a.name}`).join("; ") : "none yet"}`,
    ].join("\n");

    const routed = await routeGenerate({
      system:    WHATSAPP_SYSTEM_PROMPT,
      user:      `Workspace context:\n${contextBlock}\n\nUser request:\n"${description.slice(0, 3000)}"\n\nProduce the setup draft JSON now.`,
      maxTokens: 4000,
      ...routedArgs(workspaceId, sb),
    });

    const parsed = WhatsAppDraftSchema.parse(parseModelJson(routed.text));

    // Server-authoritative fields — never trust the model for these.
    parsed.webhook_config.inbound_path = inboundPathFor(provider, workspaceId);
    const agentIds = new Set(ctx.agents.map((a) => a.id));
    if (parsed.agent_binding.agent_id && !agentIds.has(parsed.agent_binding.agent_id)) {
      parsed.agent_binding.agent_id = null;
      parsed.agent_binding.agent_name = null;
    } else if (parsed.agent_binding.agent_id) {
      parsed.agent_binding.agent_name =
        ctx.agents.find((a) => a.id === parsed.agent_binding.agent_id)?.name ?? null;
    }
    assertNoCredentialValues(parsed, "WhatsApp setup");

    // WhatsApp provider setup is ALWAYS high risk: it configures live customer
    // messaging infrastructure.
    const riskLevel = "high" as const;
    const riskReasons = [
      "Configures the workspace's live WhatsApp messaging provider",
      ...(ctx.currentProvider && ctx.currentProvider !== provider
        ? [`Workspace currently uses "${ctx.currentProvider}" — activating must NOT silently reroute live traffic`]
        : []),
      ...(parsed.message_templates.length > 0 ? ["Includes customer-facing message templates"] : []),
    ];

    const payload = {
      kind:              "whatsapp_setup",
      provider,
      name:              parsed.name,
      purpose:           parsed.purpose,
      setup_steps:       parsed.setup_steps,
      webhook_config:    parsed.webhook_config,
      agent_binding:     parsed.agent_binding,
      message_templates: parsed.message_templates,
      risks:             parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "whatsapp_setup",
      title:                parsed.name,
      purpose:              parsed.purpose,
      payload,
      required_credentials: parsed.required_credentials,
      test_plan:            parsed.test_plan,
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       routed.provider,
      model_id:             routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    const { error: detailErr } = await sb.from("whatsapp_setup_drafts").insert({
      workspace_id:        workspaceId,
      generated_action_id: draftRow.id,
      created_by_user_id:  userId,
      provider,
      setup_steps:         parsed.setup_steps,
      webhook_config:      parsed.webhook_config,
      agent_binding:       parsed.agent_binding,
      message_templates:   parsed.message_templates,
    });
    if (detailErr) {
      // Keep hub+detail consistent: without the detail row the draft can't activate.
      await sb.from("systemmind_generated_actions").delete().eq("id", draftRow.id).eq("workspace_id", workspaceId);
      throw new Error(`Failed to save WhatsApp setup detail: ${detailErr.message}`);
    }

    await completeRun(sb, workspaceId, runId, routed);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_generated_action",
      targetId:   draftRow.id,
      proposedAfterState: { kind: "whatsapp_setup", provider, title: parsed.name, risk_level: riskLevel, status: "draft", model: routed.model },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId:      draftRow.id as string,
      draft:        draftRow,
      modelUsed:    routed.model,
      provider:     routed.provider,
      usedFallback: routed.usedFallback,
      claudeEnabled: isClaudeEnabled(),
      riskLevel,
    };
  } catch (err) {
    await failRun(sb, workspaceId, runId, err);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── WhatsApp activation (called from activateSystemMindAutomation dispatch) ──
export async function activateWhatsAppSetupKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: detail, error } = await sb.from("whatsapp_setup_drafts")
    .select("*")
    .eq("generated_action_id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!detail) throw new Error("WhatsApp setup detail row not found — activation refused.");

  const provider = String(detail.provider) as WhatsAppProvider;
  if (!["twilio", "wati", "meta"].includes(provider)) throw new Error("Invalid provider on detail row.");

  const ctx = await gatherWhatsAppContext(sb, workspaceId);
  const targetConfigured  = isProviderConfigured(ctx, provider);
  const currentWorking    = !!ctx.currentProvider && isProviderConfigured(ctx, ctx.currentProvider);

  // Provider flip rule (shared dev/prod DB — a flip reroutes ALL outbound
  // WhatsApp immediately): only flip when no OTHER provider is currently
  // working. If another provider is live, leave routing untouched and add a
  // manual-switch checklist task instead.
  let providerFlipped = false;
  let flipBlockedReason: string | null = null;
  if (targetConfigured && ctx.currentProvider !== provider) {
    if (!currentWorking) {
      const { error: flipErr } = await sb.from("workspace_settings")
        .upsert({ workspace_id: workspaceId, whatsapp_provider: provider }, { onConflict: "workspace_id" });
      if (flipErr) throw new Error(`Failed to set WhatsApp provider: ${flipErr.message}`);
      providerFlipped = true;
    } else {
      flipBlockedReason = `Workspace is actively using "${ctx.currentProvider}" — switch to "${provider}" manually in WhatsApp Settings when ready.`;
    }
  }

  // Build the manual checklist in HiveMind tasks: credential steps always, a
  // configure-provider task if the target provider is not yet configured, and
  // a manual-switch task when the flip was blocked.
  const steps = Array.isArray(detail.setup_steps) ? detail.setup_steps : [];
  const taskRows: any[] = [];
  const pushTask = (suffix: string, title: string, description: string, priority = "high") => {
    taskRows.push({
      workspace_id: workspaceId,
      title:        title.slice(0, 300),
      description:  description.slice(0, 2000),
      status:       "suggested",
      priority,
      source:       "systemmind",
      trigger_type: "whatsapp_setup",
      entity_type:  "whatsapp_setup_draft",
      entity_id:    `${detail.id}:${suffix}`,
      entity_name:  `WhatsApp setup (${provider})`,
      metadata:     { generated_action_id: generatedActionId, provider },
    });
  };

  for (const s of steps) {
    if (s?.requires_credentials) {
      pushTask(
        `step-${s.order}`,
        `WhatsApp setup (${provider}): ${s.title}`,
        `${s.details ?? ""}\n\nCredentials needed: ${(s.credential_names ?? []).join(", ") || "see WEBEE WhatsApp settings"}. Enter values ONLY in WEBEE's settings screens.`,
      );
    }
  }
  if (!targetConfigured) {
    pushTask(
      "configure",
      `Configure ${provider} credentials in WEBEE WhatsApp Settings`,
      `The ${provider} provider is not yet configured for this workspace. Complete the credential setup in WhatsApp Settings, then verify the webhook (${String(detail.webhook_config?.inbound_path ?? "")}).`,
    );
  }
  if (flipBlockedReason) {
    pushTask("switch", `Switch WhatsApp provider to ${provider} (manual)`, flipBlockedReason);
  }
  if (taskRows.length > 0) {
    // Dedupe against existing open tasks (scanner convention: trigger_type + entity_id).
    const { data: existing } = await sb.from("hivemind_tasks")
      .select("entity_id")
      .eq("workspace_id", workspaceId)
      .eq("trigger_type", "whatsapp_setup")
      .neq("status", "completed")
      .limit(500);
    const seen = new Set(((existing ?? []) as any[]).map((t) => String(t.entity_id)));
    const fresh = taskRows.filter((t) => !seen.has(t.entity_id));
    const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    if (fresh.length > 0 && (await isProposalAllowed(sb, workspaceId))) {
      await sb.from("hivemind_tasks").insert(fresh);
    }
  }

  return {
    activatedTargetType: "whatsapp_setup_draft",
    activatedTargetId:   detail.id as string,
    summary: {
      provider,
      provider_flipped:    providerFlipped,
      flip_blocked_reason: flipBlockedReason,
      target_configured:   targetConfigured,
      checklist_tasks:     taskRows.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Follow-Up Sequence Generator
// ═══════════════════════════════════════════════════════════════════════════

const SEQUENCE_CHANNELS = ["email", "whatsapp", "sms", "ai_call", "task", "notification"] as const;

const SequenceItemSchema = z.object({
  day_number: z.number().int().min(1).max(90),
  channel:    z.enum(SEQUENCE_CHANNELS),
  title:      z.string().min(1).max(200),
  message:    z.string().max(2000).default(""),
  notes:      z.string().max(500).default(""),
});

const FollowUpDraftSchema = z.object({
  name:            z.string().min(1).max(200),
  purpose:         z.string().min(1).max(2000),
  sequence:        z.array(SequenceItemSchema).min(1).max(30),
  stop_conditions: z.array(z.string().max(300)).max(10).default([]),
  target_statuses: z.array(z.string().max(60)).max(10).default([]),
  ...CommonTailSchema,
});

type FollowUpDraft = z.infer<typeof FollowUpDraftSchema>;

// Compile a sequence draft into the Follow Up Centre's real data model
// (hexmail_campaigns + hexmail_campaign_steps: day_number + actions jsonb).
export function compileSequenceToHexmailCampaign(draft: {
  name: string; purpose: string;
  sequence: Array<{ day_number: number; channel: string; title: string; message?: string; notes?: string }>;
  target_statuses?: string[];
}): {
  campaign: { name: string; description: string; config: Record<string, unknown> };
  steps: Array<{ day_number: number; actions: Array<Record<string, unknown>> }>;
} {
  const byDay = new Map<number, Array<Record<string, unknown>>>();
  for (const item of draft.sequence) {
    const actions = byDay.get(item.day_number) ?? [];
    actions.push({
      id:          randomUUID(),
      type:        item.channel,
      template_id: null,
      notes:       item.title,
      config: {
        title:   item.title,
        message: item.message ?? "",
        notes:   item.notes ?? "",
        source:  "systemmind",
      },
    });
    byDay.set(item.day_number, actions);
  }
  const steps = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day_number, actions]) => ({ day_number, actions }));

  return {
    campaign: {
      name:        draft.name.slice(0, 200),
      description: draft.purpose.slice(0, 1000),
      config: {
        target_statuses: draft.target_statuses ?? [],
        frequency:       "daily",
        source:          "systemmind",
      },
    },
    steps,
  };
}

const FOLLOWUP_SYSTEM_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform. You design a multi-day FOLLOW-UP SEQUENCE DRAFT for leads. You NEVER execute or send anything — draft only, for human approval. On approval the sequence becomes a Follow Up Centre campaign (day-numbered steps). Leads are NOT auto-enrolled — a human enrolls leads explicitly.

Channels available per step: email, whatsapp, sms, ai_call (outbound AI phone call), task (internal to-do for the team), notification (internal alert).

Return ONLY valid JSON:
{
  "name": "...",
  "purpose": "...",
  "sequence": [ { "day_number": 1, "channel": "email", "title": "...", "message": "<the message template text, {{name}} placeholders allowed>", "notes": "..." } ],
  "stop_conditions": ["Lead replies", "Lead books a meeting", ...],
  "target_statuses": ["interested", ...] or [],
  "required_credentials": ["..."],
  "risks": ["..."],
  "test_plan": ["..."]
}

RULES:
- 3–10 sequence items across sensible days (day_number = days after enrollment, starting at 1). Escalate gently; do not message more than once per day per channel.
- Message templates must be professional, non-spammy, with a clear reason for contact. Include opt-out language for email/SMS where appropriate.
- target_statuses: only include lead statuses if the user's request clearly targets a segment (valid: need_to_call, calling, contact_made, interested, qualified, not_interested, callback_requested). Otherwise [].
- risks: real risks (customer messaging volume, wrong-segment targeting).
- test_plan: 3–6 manual verification steps (e.g. enroll one test lead first).`;

export interface GenerateFollowUpArgs {
  workspaceId:   string;
  userId:        string | null;
  description:   string;
  instructedBy?: "user" | "hivemind" | "admin";
}

export async function generateFollowUpSequenceDraftServer(args: GenerateFollowUpArgs) {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, description } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to generate.");

  const runId = await createRun(sb, workspaceId, userId, instructedBy, "follow_up_sequence_generation", description);

  try {
    const routed = await routeGenerate({
      system:    FOLLOWUP_SYSTEM_PROMPT,
      user:      `Design a follow-up sequence for this request:\n\n"${description.slice(0, 3000)}"\n\nDraft only, strict JSON.`,
      maxTokens: 4000,
      ...routedArgs(workspaceId, sb),
    });

    const parsed: FollowUpDraft = FollowUpDraftSchema.parse(parseModelJson(routed.text));
    assertNoCredentialValues(parsed, "Follow-up sequence");

    const compiled = compileSequenceToHexmailCampaign(parsed);

    // Risk: external messaging channels → high; whole-segment targeting → bulk.
    const channels = new Set(parsed.sequence.map((s) => s.channel));
    const riskReasons: string[] = [];
    if (channels.has("email"))    riskReasons.push("Sends emails to customers");
    if (channels.has("whatsapp")) riskReasons.push("Sends WhatsApp messages to customers");
    if (channels.has("sms"))      riskReasons.push("Sends SMS messages to customers");
    if (channels.has("ai_call"))  riskReasons.push("Queues outbound AI calls to leads");
    if (parsed.target_statuses.length > 0) {
      riskReasons.push(`Bulk: targets entire lead segments (${parsed.target_statuses.join(", ")})`);
    }
    const textBlob = `${parsed.name} ${parsed.purpose} ${description}`.toLowerCase();
    if (/\ball leads\b|\bevery lead\b|\bevery contact\b|\ball contacts\b/.test(textBlob)) {
      riskReasons.push("Bulk: request references all leads/contacts");
    }
    const riskLevel: "low" | "medium" | "high" = riskReasons.length > 0 ? "high" : "medium";

    const payload = {
      kind:            "follow_up_sequence",
      name:            parsed.name,
      purpose:         parsed.purpose,
      sequence:        parsed.sequence,
      stop_conditions: parsed.stop_conditions,
      target_statuses: parsed.target_statuses,
      compiled_campaign: compiled,
      risks:           parsed.risks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "follow_up_sequence",
      title:                parsed.name,
      purpose:              parsed.purpose,
      payload,
      required_credentials: parsed.required_credentials,
      test_plan:            [
        ...parsed.test_plan,
        "Note: campaign day-advancement follows the Follow Up Centre's existing behavior — enroll a single test lead and verify step timing before enrolling real leads.",
      ].slice(0, 20),
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       routed.provider,
      model_id:             routed.model,
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    const { error: detailErr } = await sb.from("follow_up_sequence_drafts").insert({
      workspace_id:        workspaceId,
      generated_action_id: draftRow.id,
      created_by_user_id:  userId,
      name:                parsed.name,
      purpose:             parsed.purpose,
      sequence:            parsed.sequence,
      stop_conditions:     parsed.stop_conditions,
      target_statuses:     parsed.target_statuses,
      compiled_campaign:   compiled,
    });
    if (detailErr) {
      await sb.from("systemmind_generated_actions").delete().eq("id", draftRow.id).eq("workspace_id", workspaceId);
      throw new Error(`Failed to save follow-up sequence detail: ${detailErr.message}`);
    }

    await completeRun(sb, workspaceId, runId, routed);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_generated_action",
      targetId:   draftRow.id,
      proposedAfterState: { kind: "follow_up_sequence", title: parsed.name, risk_level: riskLevel, status: "draft", model: routed.model },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId:      draftRow.id as string,
      draft:        draftRow,
      modelUsed:    routed.model,
      provider:     routed.provider,
      usedFallback: routed.usedFallback,
      claudeEnabled: isClaudeEnabled(),
      riskLevel,
    };
  } catch (err) {
    await failRun(sb, workspaceId, runId, err);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── Follow-up activation: compile → hexmail campaign (NO auto-enrollment) ────
export async function activateFollowUpSequenceKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: detail, error } = await sb.from("follow_up_sequence_drafts")
    .select("*")
    .eq("generated_action_id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!detail) throw new Error("Follow-up sequence detail row not found — activation refused.");

  // Re-validate the stored sequence server-side — never trust DB contents blindly.
  const seqParsed = z.array(SequenceItemSchema).min(1).max(30).safeParse(detail.sequence ?? []);
  if (!seqParsed.success) throw new Error("Sequence failed safety re-validation — activation refused.");

  const compiled = compileSequenceToHexmailCampaign({
    name:            String(detail.name ?? "SystemMind follow-up sequence"),
    purpose:         String(detail.purpose ?? ""),
    sequence:        seqParsed.data,
    target_statuses: Array.isArray(detail.target_statuses) ? detail.target_statuses : [],
  });

  const { data: campaign, error: cErr } = await sb.from("hexmail_campaigns").insert({
    workspace_id: workspaceId,
    name:         compiled.campaign.name,
    description:  compiled.campaign.description,
    status:       "active",
    config:       compiled.campaign.config,
  }).select("id").single();
  if (cErr) throw new Error(`Failed to create campaign: ${cErr.message}`);

  const stepRows = compiled.steps.map((s) => ({
    campaign_id: campaign.id,
    day_number:  s.day_number,
    actions:     s.actions,
  }));
  const { error: sErr } = await sb.from("hexmail_campaign_steps").insert(stepRows);
  if (sErr) {
    await sb.from("hexmail_campaigns").delete().eq("id", campaign.id).eq("workspace_id", workspaceId);
    throw new Error(`Failed to create campaign steps: ${sErr.message}`);
  }

  await sb.from("follow_up_sequence_drafts")
    .update({ activated_campaign_id: campaign.id })
    .eq("id", detail.id)
    .eq("workspace_id", workspaceId);

  return {
    activatedTargetType: "hexmail_campaign",
    activatedTargetId:   campaign.id as string,
    summary: { campaign_id: campaign.id, steps: stepRows.length, auto_enrollment: false },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. n8n → WEBEE Workflow Conversion
// ═══════════════════════════════════════════════════════════════════════════

type NodeClassification =
  | { kind: "trigger"; triggerType: "scheduled" | "manual"; warning?: string }
  | { kind: "map"; webeeType: string; warning?: string }
  | { kind: "skip" }
  | { kind: "block"; reason: string; bulk?: boolean };

// Deterministic n8n node-type classification. SECURITY: nodes that execute
// arbitrary code, hit arbitrary URLs, or run shell commands are NEVER
// auto-mapped — they are flagged unconvertible with an explicit reason.
export function classifyN8nNode(rawType: string): NodeClassification {
  const t = rawType.toLowerCase();

  if (t.includes("stickynote")) return { kind: "skip" };

  // Hard security blocks BEFORE any mapping.
  if (t.includes("httprequest"))
    return { kind: "block", reason: "HTTP request to an arbitrary URL — not auto-converted for security. Re-implement via a vetted WEBEE integration." };
  if (t.includes("executecommand") || t.includes(".ssh"))
    return { kind: "block", reason: "Executes shell commands — never auto-converted." };
  if (t.endsWith(".code") || t.includes("nodes-base.function"))
    return { kind: "block", reason: "Custom code node — logic must be reviewed and re-implemented manually." };
  if (t.includes("executeworkflow"))
    return { kind: "block", reason: "Sub-workflow call — convert the referenced workflow separately." };
  if (t.includes("respondtowebhook"))
    return { kind: "block", reason: "Webhook response node — WEBEE workflows do not serve HTTP responses." };
  if (t.includes("splitinbatches") || t.includes("nodes-base.loop"))
    return { kind: "block", reason: "Batch/loop processing — bulk scope must be reviewed manually.", bulk: true };

  // Triggers.
  if (t.includes("cron") || t.includes("scheduletrigger") || t.includes("intervaltrigger") || t.includes("nodes-base.interval") || t.includes("schedule"))
    return { kind: "trigger", triggerType: "scheduled" };
  if (t.includes("manualtrigger"))
    return { kind: "trigger", triggerType: "manual" };
  if (t.endsWith(".webhook") || t.includes("webhook"))
    return { kind: "trigger", triggerType: "manual", warning: "Webhook trigger converted to manual trigger — WEBEE workflows are not publicly callable via webhook." };
  if (t.includes("trigger"))
    return { kind: "trigger", triggerType: "manual", warning: `Trigger "${rawType}" has no direct WEBEE equivalent — converted to manual trigger.` };

  // Channel / action mappings.
  if (t.includes("wati") || t.includes("whatsapp"))
    return { kind: "map", webeeType: "send_whatsapp" };
  if (t.includes("twilio"))
    return { kind: "map", webeeType: "send_whatsapp", warning: "Twilio node may be SMS rather than WhatsApp — verify the channel after conversion." };
  if (t.includes("gmail") || t.includes("emailsend") || t.includes("smtp") || t.includes("sendgrid") || t.includes("mailjet") || t.includes("mandrill") || t.includes("emailreadimap") === false && t.includes("email"))
    return { kind: "map", webeeType: "send_email" };
  if (t.includes("slack") || t.includes("telegram") || t.includes("discord") || t.includes("pushover") || t.includes("pushbullet") || t.includes("gotify"))
    return { kind: "map", webeeType: "notify_user", warning: "External chat notification routed to a WEBEE workspace notification instead." };
  if (t.includes("hubspot") || t.includes("salesforce") || t.includes("pipedrive") || t.includes("zohocrm") || t.includes("agilecrm") || t.includes("copper"))
    return { kind: "map", webeeType: "push_to_crm", warning: "CRM write mapped to WEBEE's connected-CRM sync — verify field mapping." };
  if (t.includes("nodes-base.wait"))
    return { kind: "map", webeeType: "create_callback", warning: "WEBEE workflows execute synchronously — the wait becomes a scheduled callback reminder, not a hard pause." };
  if (t.includes("nodes-base.if") || t.includes("nodes-base.switch") || t.includes("nodes-base.filter"))
    return { kind: "map", webeeType: "branch", warning: "Branch conditions could not be translated automatically — configure them manually before relying on this workflow." };
  if (t.includes("nodes-base.set") || t.includes("nodes-base.merge") || t.includes("itemlists") || t.includes("splitout") || t.includes("aggregate") || t.includes("datetime") || t.includes("nodes-base.crypto") || t.includes("noop"))
    return { kind: "block", reason: "Data transformation node — no WEBEE equivalent; re-implement the logic manually if required." };

  return { kind: "block", reason: `No WEBEE equivalent for node type "${rawType}".` };
}

export interface N8nMappingReport {
  converted:     Array<{ node: string; n8n_type: string; webee_step: string }>;
  unconvertible: Array<{ node: string; n8n_type: string; reason: string }>;
  warnings:      string[];
}

export function convertN8nNodesToSteps(raw: any): {
  steps: any[];
  triggerType: "scheduled" | "manual";
  report: N8nMappingReport;
  hasBulk: boolean;
} {
  const nodes: any[] = Array.isArray(raw?.nodes) ? raw.nodes : [];
  const byName = new Map<string, any>();
  for (const n of nodes) byName.set(String(n?.name ?? n?.id ?? ""), n);

  const report: N8nMappingReport = { converted: [], unconvertible: [], warnings: [] };
  let triggerType: "scheduled" | "manual" = "manual";
  let hasBulk = false;

  const mapped: Array<{ node: any; webeeType: string }> = [];
  for (const node of nodes) {
    const nodeName = String(node?.name ?? node?.id ?? "node");
    const rawType  = String(node?.type ?? "");
    const cls = classifyN8nNode(rawType);
    if (cls.kind === "skip") continue;
    if (cls.kind === "trigger") {
      if (cls.triggerType === "scheduled") triggerType = "scheduled";
      if (cls.warning) report.warnings.push(`${nodeName}: ${cls.warning}`);
      continue;
    }
    if (cls.kind === "block") {
      report.unconvertible.push({ node: nodeName, n8n_type: rawType, reason: cls.reason });
      if (cls.bulk) hasBulk = true;
      continue;
    }
    if (cls.warning) report.warnings.push(`${nodeName}: ${cls.warning}`);
    report.converted.push({ node: nodeName, n8n_type: rawType, webee_step: cls.webeeType });
    mapped.push({ node, webeeType: cls.webeeType });
  }

  // Build a linear WEBEE step chain in n8n's stored node order (metadata
  // execution order is advisory; unconvertible nodes are excluded but LISTED).
  const steps: any[] = [{ id: "step-1", type: "trigger" }];
  mapped.forEach(({ node, webeeType }, i) => {
    const id = `step-${i + 2}`;
    const step: any = { id, type: webeeType };
    const nodeName = String(node?.name ?? "step").slice(0, 200);
    if (webeeType === "create_task" || webeeType === "notify_user") step.title = nodeName;
    if (webeeType === "send_whatsapp") step.template = nodeName.slice(0, 120);
    if (webeeType === "create_callback") {
      const params = node?.parameters ?? {};
      const amount = Number(params?.amount ?? params?.time ?? 24);
      const unit   = String(params?.unit ?? "hours").toLowerCase();
      let hours = amount;
      if (unit.startsWith("minute")) hours = amount / 60;
      if (unit.startsWith("day"))    hours = amount * 24;
      if (unit.startsWith("week"))   hours = amount * 24 * 7;
      step.delay_hours = Math.max(0, Math.min(720, Math.round(hours)));
    }
    if (webeeType === "branch") step.conditions = [];
    steps.push(step);
  });
  // Chain next pointers linearly.
  for (let i = 0; i < steps.length - 1; i++) steps[i].next = steps[i + 1].id;

  return { steps, triggerType, report, hasBulk };
}

const N8N_AI_SYSTEM_PROMPT = `You are SystemMind, the AI CTO of the WEBEE platform. You are given the result of a deterministic n8n→WEBEE workflow conversion (mapping already done by code — do NOT change it). Your job is ONLY to name and describe the converted workflow and assess risks. NEVER include credential values.

Return ONLY valid JSON:
{
  "name": "...",
  "purpose": "...",
  "risks": ["..."],
  "test_plan": ["..."],
  "summary": "<2-4 sentence plain-language summary of what converted cleanly and what needs manual attention>"
}`;

export interface ConvertN8nArgs {
  workspaceId:   string;
  userId:        string | null;
  n8nRowId:      string;
  instructedBy?: "user" | "hivemind" | "admin";
}

export async function convertN8nWorkflowServer(args: ConvertN8nArgs) {
  const sb = supabaseAdmin as any;
  const { workspaceId, userId, n8nRowId } = args;
  const instructedBy = args.instructedBy ?? "user";
  if (!workspaceId) throw new Error("workspace_id missing — refusing to convert.");

  // READ-ONLY: conversion works from the stored discovery snapshot, never the n8n API.
  const { data: src, error: srcErr } = await sb.from("systemmind_n8n_workflows")
    .select("id, n8n_workflow_id, name, raw_snapshot, metadata")
    .eq("id", n8nRowId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (srcErr) throw new Error(srcErr.message);
  if (!src) throw new Error("n8n workflow not found in this workspace — run a discovery scan first.");

  const runId = await createRun(
    sb, workspaceId, userId, instructedBy, "n8n_conversion",
    `Convert n8n workflow "${src.name}" (${src.n8n_workflow_id})`,
  );

  try {
    const { steps, triggerType, report, hasBulk } = convertN8nNodesToSteps(src.raw_snapshot);

    // Validate + sanitise the generated steps exactly like any other draft.
    const stepsParsed = z.array(StepSchema).min(1).max(30).safeParse(steps);
    if (!stepsParsed.success) throw new Error("Converted steps failed schema validation — conversion aborted.");
    const safeSteps = sanitizeGeneratedSteps(stepsParsed.data);
    if (safeSteps.length === 0) throw new Error("No valid steps after safety filtering — conversion aborted.");

    // AI pass for naming/description ONLY — deterministic fallback if it fails.
    let aiName    = `Converted from n8n: ${String(src.name).slice(0, 160)}`;
    let aiPurpose = `WEBEE workflow converted from the n8n workflow "${src.name}". ${report.converted.length} node(s) converted, ${report.unconvertible.length} need manual attention.`;
    let aiRisks: string[] = [];
    let aiTestPlan: string[] = [
      "Review the mapping report — every unconvertible node needs a manual decision.",
      "Run the workflow manually against a single test lead before enabling any schedule.",
      "Verify branch conditions (if any) — they are NOT auto-translated.",
    ];
    let aiSummary = aiPurpose;
    let routed: any = null;
    try {
      routed = await routeGenerate({
        system:    N8N_AI_SYSTEM_PROMPT,
        user:      `Source n8n workflow: "${src.name}"\nNode types: ${((src.metadata?.nodeTypes ?? []) as string[]).slice(0, 30).join(", ")}\n\nConverted steps (WEBEE): ${safeSteps.map((s: any) => s.type).join(" → ")}\nUnconvertible: ${report.unconvertible.map((u) => `${u.node} (${u.reason})`).join("; ") || "none"}\nWarnings: ${report.warnings.join("; ") || "none"}\n\nProduce the JSON now.`,
        maxTokens: 1500,
        ...routedArgs(workspaceId, sb),
      });
      const ai = z.object({
        name:      z.string().min(1).max(200),
        purpose:   z.string().min(1).max(2000),
        risks:     z.array(z.string().max(300)).max(20).default([]),
        test_plan: z.array(z.string().max(400)).max(20).default([]),
        summary:   z.string().max(2000).default(""),
      }).parse(parseModelJson(routed.text));
      aiName = ai.name; aiPurpose = ai.purpose; aiRisks = ai.risks;
      if (ai.test_plan.length > 0) aiTestPlan = ai.test_plan;
      if (ai.summary) aiSummary = ai.summary;
    } catch (aiErr) {
      report.warnings.push(`AI naming pass unavailable (${aiErr instanceof Error ? aiErr.message : "error"}) — deterministic description used.`);
    }

    const blueprint = {
      name:           aiName,
      trigger_type:   triggerType,
      trigger_config: {},
      steps:          safeSteps,
      source:         "n8n",
      source_summary: aiSummary,
    };
    assertNoCredentialValues({ blueprint, report }, "n8n conversion");

    // Deterministic risk classification on the converted steps + bulk flag.
    const riskDraft: GeneratedDraft = {
      name: aiName, purpose: aiPurpose, trigger_type: triggerType, trigger_config: {},
      steps: safeSteps as any, custom_prompt: "",
      required_credentials: [], risks: aiRisks, test_plan: aiTestPlan,
    };
    const { riskLevel: baseRisk, riskReasons } = classifyDraftRisk(riskDraft);
    let riskLevel = baseRisk;
    if (hasBulk) {
      riskLevel = "high";
      riskReasons.push("Bulk: source n8n workflow processes items in batches/loops");
    }
    if (report.unconvertible.length > 0) {
      riskReasons.push(`${report.unconvertible.length} node(s) could not be converted and need manual review`);
      if (riskLevel === "low") riskLevel = "medium";
    }

    const payload = {
      kind:           "n8n_blueprint",
      name:           aiName,
      purpose:        aiPurpose,
      blueprint,
      mapping_report: report,
      source: { row_id: src.id, n8n_workflow_id: src.n8n_workflow_id, name: src.name },
      risks:          aiRisks,
    };

    const { data: draftRow, error: draftErr } = await sb.from("systemmind_generated_actions").insert({
      workspace_id:         workspaceId,
      run_id:               runId,
      created_by_user_id:   userId,
      source:               "systemmind",
      instructed_by:        instructedBy,
      action_kind:          "n8n_blueprint",
      title:                aiName,
      purpose:              aiPurpose,
      payload,
      required_credentials: [],
      test_plan:            aiTestPlan,
      risk_level:           riskLevel,
      risk_reasons:         riskReasons,
      approval_required:    true,
      status:               "draft",
      model_provider:       routed?.provider ?? "deterministic",
      model_id:             routed?.model ?? "rule-based-mapper",
    }).select("*").single();
    if (draftErr) throw new Error(`Failed to save draft: ${draftErr.message}`);

    const { error: detailErr } = await sb.from("workflow_blueprints").insert({
      workspace_id:        workspaceId,
      generated_action_id: draftRow.id,
      created_by_user_id:  userId,
      source:              "n8n",
      source_row_id:       src.id,
      source_workflow_id:  String(src.n8n_workflow_id ?? ""),
      source_name:         String(src.name ?? ""),
      blueprint,
      mapping_report:      report,
      unconvertible_count: report.unconvertible.length,
    });
    if (detailErr) {
      await sb.from("systemmind_generated_actions").delete().eq("id", draftRow.id).eq("workspace_id", workspaceId);
      throw new Error(`Failed to save blueprint detail: ${detailErr.message}`);
    }

    await completeRun(sb, workspaceId, runId, routed);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_generated_action",
      targetId:   draftRow.id,
      proposedAfterState: {
        kind: "n8n_blueprint", title: aiName, risk_level: riskLevel, status: "draft",
        converted: report.converted.length, unconvertible: report.unconvertible.length,
      },
      approvalStatus: "not_requested",
    });

    return {
      runId,
      draftId:       draftRow.id as string,
      draft:         draftRow,
      mappingReport: report,
      modelUsed:     routed?.model ?? "rule-based-mapper",
      provider:      routed?.provider ?? "deterministic",
      usedFallback:  routed?.usedFallback ?? false,
      claudeEnabled: isClaudeEnabled(),
      riskLevel,
    };
  } catch (err) {
    await failRun(sb, workspaceId, runId, err);
    await writeSystemMindAudit({
      workspaceId, userId, instructedBy,
      actionType: "generate_draft",
      targetType: "systemmind_run",
      targetId:   runId,
      error:      err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

// ── n8n blueprint activation: blueprint → workspace_workflows ─────────────────
export async function activateN8nBlueprintKind(
  workspaceId: string,
  generatedActionId: string,
): Promise<{ activatedTargetType: string; activatedTargetId: string; summary: Record<string, unknown> }> {
  const sb = supabaseAdmin as any;
  const { data: detail, error } = await sb.from("workflow_blueprints")
    .select("*")
    .eq("generated_action_id", generatedActionId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!detail) throw new Error("Workflow blueprint detail row not found — activation refused.");

  const blueprint = detail.blueprint ?? {};
  const stepsParsed = z.array(StepSchema).min(1).max(30).safeParse(blueprint.steps ?? []);
  if (!stepsParsed.success) throw new Error("Blueprint steps failed safety re-validation — activation refused.");
  const safeSteps = sanitizeGeneratedSteps(stepsParsed.data);
  if (safeSteps.length === 0) throw new Error("No valid steps after safety filtering — activation refused.");

  const triggerType = ["lead_added", "lead_status_changed", "call_completed", "manual", "scheduled"]
    .includes(String(blueprint.trigger_type)) ? String(blueprint.trigger_type) : "manual";

  const { data: wf, error: wfErr } = await sb.from("workspace_workflows").insert({
    workspace_id:    workspaceId,
    template_id:     null,
    name:            String(blueprint.name ?? detail.source_name ?? "Converted n8n workflow").slice(0, 200),
    description:     `Converted from n8n workflow "${detail.source_name}" (read-only conversion; blueprint ${detail.id}). ${String(blueprint.source_summary ?? "").slice(0, 400)}`,
    trigger_type:    triggerType,
    trigger_config:  blueprint.trigger_config ?? {},
    flow_definition: { steps: safeSteps, source: "n8n", blueprint_id: detail.id },
    status:          "active",
  }).select("id").single();
  if (wfErr) throw new Error(`Failed to create workflow: ${wfErr.message}`);

  await sb.from("workflow_blueprints")
    .update({ activated_workflow_id: wf.id })
    .eq("id", detail.id)
    .eq("workspace_id", workspaceId);

  return {
    activatedTargetType: "workspace_workflow",
    activatedTargetId:   wf.id as string,
    summary: {
      workflow_id: wf.id,
      unconvertible_count: detail.unconvertible_count ?? 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Reads
// ═══════════════════════════════════════════════════════════════════════════

const DETAIL_TABLE_BY_KIND: Record<string, string> = {
  whatsapp_setup:     "whatsapp_setup_drafts",
  follow_up_sequence: "follow_up_sequence_drafts",
  n8n_blueprint:      "workflow_blueprints",
};

export async function getDraftDetailServer(
  workspaceId: string,
  draftId: string,
): Promise<{ draft: any; detail: any | null }> {
  const sb = supabaseAdmin as any;
  const { data: draft, error } = await sb.from("systemmind_generated_actions")
    .select("*")
    .eq("id", draftId)
    .eq("workspace_id", workspaceId)
    .eq("is_deleted", false)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft) throw new Error("Draft not found in this workspace.");

  const table = DETAIL_TABLE_BY_KIND[String(draft.action_kind)];
  if (!table) return { draft, detail: null };

  const { data: detail, error: dErr } = await sb.from(table)
    .select("*")
    .eq("generated_action_id", draftId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (dErr) throw new Error(dErr.message);
  return { draft, detail: detail ?? null };
}
