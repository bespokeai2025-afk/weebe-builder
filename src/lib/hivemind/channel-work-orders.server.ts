/**
 * Channel work orders — Task #488 (Sales, CRM & comms channel depth).
 *
 * Five proposal cores (sales pipeline, follow-up sequence, WhatsApp campaign,
 * email campaign, call campaign) that turn a chat instruction into an
 * evidence-backed work order with SPLIT, SCOPED approval-stage tasks through
 * the universal intelligence-packet quality gate.
 *
 * Honesty rules enforced here:
 *  - Evidence comes from REAL workspace rows/services — never invented.
 *  - The final Send/Launch stage is created BLOCKED ("Awaiting prior stage
 *    approvals") — approving copy never authorises sending.
 *  - Missing provider/integration → integration_missing blocker on every
 *    stage (readiness "integration_required"), not a fake ready state.
 *  - Consent / opt-out / suppression / duplicate filtering is applied when
 *    the audience is resolved and the exclusions are recorded as evidence.
 *  - No stage task carries an action_kind: there is no channel auto-send
 *    executor — approvals authorise the humans/flows that already exist.
 *  - WBAH is excluded from every core.
 */

import {
  filterAudienceForChannel,
  approvalStagesForChannel,
  buildFollowUpSequencePlan,
  sequenceHasNoOverlappingSends,
  analysePipelineLeads,
  pipelineProposedChanges,
  summariseAudiencePreferences,
  summariseCountryDistribution,
  estimateWhatsAppCampaignCost,
  SEQUENCE_STOP_CONDITIONS,
  type ApprovalStage,
  type AudienceComplianceResult,
  type AudienceLeadInput,
  type ChannelCampaignKind,
  type OutreachChannel,
} from "@/lib/minds/channel-packets.shared";
import type {
  PacketEvidence,
  PacketTarget,
  UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";

type Sb = any;

const LEAD_AUDIENCE_COLUMNS =
  "id, full_name, phone, email, status, pipeline_stage, whatsapp_opt_in, last_contacted_at, updated_at, created_at, qualification_status, " +
  "sale_amount, call_outcome, objections, external_source_id, source, state_name, meta";

async function guards(sb: Sb, workspaceId: string): Promise<void> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);
}

export interface AudienceFilterOptions {
  pipelineStage?: string | null;
  status?: string | null;
  qualificationStatus?: string | null;
  maxLeads?: number | null;
}

async function loadAudienceLeads(
  sb: Sb,
  workspaceId: string,
  f: AudienceFilterOptions = {},
): Promise<AudienceLeadInput[]> {
  let q = sb.from("leads").select(LEAD_AUDIENCE_COLUMNS).eq("workspace_id", workspaceId);
  if (f.pipelineStage) q = q.eq("pipeline_stage", f.pipelineStage);
  if (f.status) q = q.eq("status", f.status);
  if (f.qualificationStatus) q = q.eq("qualification_status", f.qualificationStatus);
  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .limit(Math.min(5000, Math.max(1, f.maxLeads ?? 1000)));
  if (error) throw new Error(error.message);
  return (data ?? []) as AudienceLeadInput[];
}

async function loadSuppressedEmails(sb: Sb, workspaceId: string): Promise<string[]> {
  const { data, error } = await sb
    .from("suppressed_emails")
    .select("email")
    .eq("workspace_id", workspaceId)
    .limit(5000);
  if (error) {
    throw new Error(`Suppression list could not be loaded (${error.message}); refusing to build an email audience without it.`);
  }
  return ((data ?? []) as Array<{ email: string }>).map((r) => r.email);
}

function audienceEvidence(
  evidenceItem: (s: string, d: string, data?: Record<string, unknown> | null) => PacketEvidence,
  compliance: AudienceComplianceResult,
  filter: AudienceFilterOptions,
): PacketEvidence {
  return evidenceItem("leads", compliance.summary, {
    channel: compliance.channel,
    total_input: compliance.totalInput,
    eligible: compliance.eligible.length,
    excluded: compliance.excluded,
    filter: {
      pipeline_stage: filter.pipelineStage ?? null,
      status: filter.status ?? null,
      qualification_status: filter.qualificationStatus ?? null,
    },
  });
}

// ── Shared insert: one work order + one task per approval stage ──────────────
interface StageTaskSpec {
  stage: ApprovalStage;
  title: string;
  description: string;
  packet: UniversalMindIntelligencePacket;
}

async function insertWorkOrderWithStageTasks(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: {
    title: string;
    objective: string;
    source?: string;
    metadata?: Record<string, unknown> | null;
    packet: UniversalMindIntelligencePacket;
    readiness: string;
    stageTasks: StageTaskSpec[];
    triggerType: string;
  },
): Promise<{ workOrder: any; tasks: any[] }> {
  const { prepareMindTaskInsert } = await import("@/lib/minds/intelligence-packet.server");

  const { data: wo, error: we } = await sb.from("work_orders").insert({
    workspace_id: workspaceId,
    title: opts.title,
    objective: opts.objective,
    status: "open",
    source: opts.source ?? "hivemind_chat",
    created_by_user_id: userId,
    assigned_minds: ["hivemind"],
    metadata: opts.metadata ?? null,
    intelligence_packet: opts.packet,
    readiness_state: opts.readiness,
    packet_version: opts.packet.version,
  }).select("*").single();
  if (we) throw we;

  const tasks: any[] = [];
  try {
    for (const spec of opts.stageTasks) {
      const row = prepareMindTaskInsert({
        workspace_id: workspaceId,
        title: spec.title,
        description: spec.description,
        status: "suggested",
        priority: "medium",
        source: "work_order",
        trigger_type: opts.triggerType,
        task_category: "informational",
        assigned_mind: "hivemind",
        work_order_id: wo.id,
        metadata: {
          approval_stage: spec.stage.key,
          approval_stage_label: spec.stage.label,
          final_send_stage: spec.stage.finalSend,
        },
      }, spec.packet);
      const { data: task, error: te } = await sb.from("hivemind_tasks")
        .insert(row).select("*").single();
      if (te) throw te;
      tasks.push(task);
    }
  } catch (e) {
    // Rollback the whole chain — never leave a work order with partial stages.
    if (tasks.length) {
      await sb.from("hivemind_tasks").delete()
        .in("id", tasks.map((t) => t.id)).eq("workspace_id", workspaceId);
    }
    await sb.from("work_orders").delete().eq("id", wo.id).eq("workspace_id", workspaceId);
    throw e;
  }
  return { workOrder: wo, tasks };
}

/** Blocker list for the final Send/Launch stage — honest "blocked" readiness. */
function finalSendBlockers(priorLabels: string[]): Array<{ kind: "other"; detail: string }> {
  return [{
    kind: "other",
    detail: `Awaiting prior stage approvals (${priorLabels.join(", ")}) — sending is never authorised by earlier approvals alone.`,
  }];
}

function stagePacket(input: {
  buildIntelligencePacket: (i: any) => UniversalMindIntelligencePacket;
  mind?: string;
  objective: string;
  intentSource: string;
  instruction?: string | null;
  stage: ApprovalStage;
  allStages: ApprovalStage[];
  targets: PacketTarget[];
  evidence: PacketEvidence[];
  diagnosis: string;
  planSteps: Array<{ title: string; detail?: string | null }>;
  proposedChanges?: Array<{ target: string; change: string; reversible: boolean }>;
  deliverables: string[];
  successCriteria: string[];
  limitations: string[];
  approvalSummary: string;
  sensitive?: boolean;
  integrationBlockers?: Array<{ kind: "integration_missing" | "provider_error" | "other"; detail: string }>;
  costNote?: string;
}): UniversalMindIntelligencePacket {
  const priorLabels = input.allStages
    .filter((s) => !s.finalSend)
    .map((s) => s.label);
  const blockers = [
    ...(input.integrationBlockers ?? []),
    ...(input.stage.finalSend ? finalSendBlockers(priorLabels) : []),
  ];
  return input.buildIntelligencePacket({
    mind: input.mind ?? "hivemind",
    objective: input.objective,
    intentSource: input.intentSource,
    instruction: input.instruction ?? null,
    targets: input.targets,
    evidence: input.evidence,
    diagnosis: input.diagnosis,
    planSteps: input.planSteps,
    proposedChanges: input.proposedChanges ?? [],
    deliverables: input.deliverables,
    successCriteria: input.successCriteria,
    limitations: input.limitations,
    cost: { known: false, note: input.costNote ?? "Provider send costs depend on final audience size and provider pricing — not estimated." },
    approvalScope: {
      kind: input.stage.kind,
      summary: input.approvalSummary,
      sensitive: input.sensitive ?? input.stage.finalSend,
    },
    monitoring: { metrics: ["replies", "opt_outs", "bounces_or_failures"], reassess_after_days: 7 },
    blockers,
  });
}

// ── 1. Sales pipeline review ─────────────────────────────────────────────────
export interface PipelineWorkOrderOptions {
  objective?: string | null;
  instruction?: string | null;
  stalledAfterDays?: number;
  source?: string;
}

export async function createSalesPipelineWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: PipelineWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; analysis: ReturnType<typeof analysePipelineLeads> }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");

  const leads = await loadAudienceLeads(sb, workspaceId, { maxLeads: 2000 });
  const analysis = analysePipelineLeads(leads, { stalledAfterDays: opts.stalledAfterDays ?? 14 });
  const changes = pipelineProposedChanges(analysis);

  const objective = opts.objective?.trim() ||
    "Review the sales pipeline against real CRM data and propose record-tied follow-up, hygiene and enrichment actions.";
  const packet = buildIntelligencePacket({
    mind: "hivemind",
    objective,
    intentSource: opts.source === "hivemind_tool" ? "chat_tool:create_sales_pipeline_work_order" : "manual:sales_pipeline_work_order",
    instruction: opts.instruction ?? null,
    targets: [{
      domain: "sales",
      entity_type: "sales_pipeline",
      entity_id: null,
      entity_name: "Workspace sales pipeline",
      resolved: true,
      resolution_note: `Analysed ${analysis.totalLeads} lead row(s) from the CRM (most recent ${leads.length}).`,
    }],
    evidence: [
      evidenceItem("leads", analysis.diagnosis, {
        stage_counts: analysis.stageCounts,
        stalled: analysis.stalled,
        never_contacted: analysis.neverContacted,
        missing_contact_info: analysis.missingContactInfo,
        duplicate_phones: analysis.duplicatePhones,
        won: analysis.wonCount,
        conversion_pct: analysis.conversionPct,
        deal_value: analysis.dealValue,
        lost_reasons: analysis.lostReasons,
        lost_without_reason: analysis.lostWithoutReason,
        crm_sync_state: analysis.syncState,
        missing_critical_fields: analysis.missingCriticalFields,
      }),
    ],
    diagnosis: analysis.diagnosis,
    planSteps: [
      { title: "Review the stage-by-stage snapshot and stalled-lead list" },
      { title: "Approve/adjust the record-tied proposed actions (each names owner, channel, schedule, risk)" },
      { title: "Any outreach that follows requires its own follow-up sequence approvals (Audience/Schedule/Send)" },
    ],
    proposedChanges: changes.length ? changes : [{
      target: "Sales pipeline",
      change: "No defects detected in this snapshot — no changes proposed.",
      reversible: true,
    }],
    deliverables: ["Pipeline health snapshot with real stage counts", "Record-tied proposed actions list"],
    successCriteria: [
      "Every proposed action names a real lead or defect group",
      "No stage moves or contact happen without their own approvals",
    ],
    limitations: [
      "Analysis-only: nothing here moves pipeline stages or contacts leads.",
      "Outreach requires the separate follow-up sequence approvals with consent enforcement.",
    ],
    cost: { known: false, note: "CRM analysis only — no send costs." },
    approvalScope: {
      kind: "analysis",
      summary:
        `Approve this pipeline review: ${analysis.totalLeads} lead(s) analysed, ` +
        `${changes.length} record-tied action(s) proposed. No records change and no lead is contacted by this approval.`,
      sensitive: false,
    },
    monitoring: { metrics: ["stalled_leads", "never_contacted", "conversion_pct"], reassess_after_days: 14 },
  });

  const result = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "Sales pipeline review",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "sales_pipeline" },
    packet,
    readiness: "ready_for_analysis_approval",
    triggerType: "sales_pipeline_review",
    stageTasks: [{
      stage: { key: "analysis", label: "Pipeline Review", kind: "analysis", finalSend: false },
      title: `Pipeline review: ${analysis.totalLeads} lead(s), ${changes.length} proposed action(s)`,
      description:
        "Evidence-backed pipeline snapshot with record-tied proposed actions. " +
        "Approval accepts the review only — no stage moves, no contact.",
      packet,
    }],
  });
  return { ...result, analysis };
}

// ── 2. Follow-up sequence ────────────────────────────────────────────────────
export interface FollowUpWorkOrderOptions {
  channels?: OutreachChannel[];
  touches?: number;
  audience?: AudienceFilterOptions;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createFollowUpSequenceWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: FollowUpWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; audienceSummary: string }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");

  const channels = (opts.channels?.length ? opts.channels : ["call", "email"]) as OutreachChannel[];
  const touches = Math.min(8, Math.max(1, Math.round(opts.touches ?? 3)));
  const filter = opts.audience ?? {};
  const rawLeads = await loadAudienceLeads(sb, workspaceId, filter);
  const suppressed = channels.includes("email") ? await loadSuppressedEmails(sb, workspaceId) : [];

  // Per-channel compliance: a lead only receives a channel it is eligible for.
  const compliances = channels.map((c) =>
    filterAudienceForChannel(rawLeads, c, { suppressedEmails: suppressed }));
  const anyEligible = new Set(compliances.flatMap((c) => c.eligible.map((l) => l.id)));

  const plan = buildFollowUpSequencePlan(channels, touches);
  if (!sequenceHasNoOverlappingSends(plan)) {
    throw new Error("Internal error: generated sequence has overlapping sends.");
  }

  const stages = approvalStagesForChannel("followup");
  const targets: PacketTarget[] = [{
    domain: "sales",
    entity_type: "lead_segment",
    entity_id: null,
    entity_name: filter.pipelineStage
      ? `Leads in stage "${filter.pipelineStage}"`
      : filter.status ? `Leads with status "${filter.status}"` : "Filtered lead segment",
    resolved: true,
    resolution_note: `${anyEligible.size} lead(s) eligible on at least one channel after consent/suppression/dedup filtering.`,
  }];
  const eligibleLeads = rawLeads.filter((l) => anyEligible.has(l.id));
  const preferences = summariseAudiencePreferences(eligibleLeads as any[]);
  const evidence: PacketEvidence[] = [
    ...compliances.map((c) => audienceEvidence(evidenceItem, c, filter)),
    evidenceItem("sequence_plan", `${plan.length}-touch plan over ${plan.length ? plan[plan.length - 1].day + 1 : 0} day(s); one touch per day max.`, {
      steps: plan,
      stop_conditions: SEQUENCE_STOP_CONDITIONS,
    }),
    evidenceItem("leads", `Per-lead scheduling signals for the eligible segment: ${preferences.summary}`, {
      timezones: preferences.timezones,
      unknown_timezone: preferences.unknownTimezone,
      preferred_channels: preferences.preferredChannels,
      unknown_preferred_channel: preferences.unknownPreferredChannel,
    }),
  ];
  const diagnosis =
    `${anyEligible.size} of ${rawLeads.length} lead(s) in the segment are eligible for follow-up after consent, ` +
    `opt-out, suppression and duplicate filtering. Proposed ${plan.length}-touch sequence across ${channels.join(", ")}.`;
  const audienceSummary = compliances.map((c) => c.summary).join(" | ");
  const objective = opts.objective?.trim() ||
    `Run a ${touches}-touch follow-up sequence via ${channels.join(" + ")} for the selected lead segment, with stop conditions and consent enforcement.`;
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_followup_sequence_work_order" : "manual:followup_work_order";
  const limitations = [
    "Stop conditions always apply: " + SEQUENCE_STOP_CONDITIONS.join("; ") + ".",
    "No lead is contacted until every stage including Send is approved.",
    "Opted-out, suppressed and Do-Not-Call leads are excluded and cannot be re-added by approvals.",
  ];

  const mk = (stage: ApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    stagePacket({
      buildIntelligencePacket, objective, intentSource,
      instruction: opts.instruction, stage, allStages: stages,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the follow-up sequence`],
      successCriteria: ["Sequence stops immediately on any stop condition", "Only eligible, consenting leads are contacted"],
      limitations,
      approvalSummary: summary,
    });

  return {
    ...(await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
      title: `Follow-up sequence (${channels.join(" + ")}, ${touches} touches)`,
      objective,
      source: opts.source ?? "hivemind_chat",
      metadata: { channel_kind: "followup", channels, touches },
      packet: mk(stages[0], `Approve the follow-up audience: ${anyEligible.size} eligible lead(s).`, [{ title: "Confirm the audience after compliance filtering" }]),
      readiness: "ready_for_change_approval",
      triggerType: "followup_sequence",
      stageTasks: [
        {
          stage: stages[0],
          title: `Approve Audience: ${anyEligible.size} eligible lead(s)`,
          description: `Audience after consent/opt-out/suppression/duplicate filtering. ${audienceSummary}`,
          packet: mk(stages[0],
            `Approve Audience: ${anyEligible.size} eligible lead(s) (${audienceSummary}). Excluded leads cannot be re-added.`,
            [{ title: "Confirm the filtered audience" }]),
        },
        {
          stage: stages[1],
          title: `Approve Sequence: ${plan.length} touch(es) across ${channels.join(", ")}`,
          description: plan.map((s) => `Day ${s.day}: ${s.channel} — ${s.description}`).join("; "),
          packet: mk(stages[1],
            `Approve Sequence: ${plan.length} touch(es) (${plan.map((s) => `day ${s.day} ${s.channel}`).join(", ")}); stop conditions always apply.`,
            plan.map((s) => ({ title: `Day ${s.day}: ${s.channel} touch (${s.window})` }))),
        },
        {
          stage: stages[2],
          title: "Approve Schedule: send windows and pacing",
          description: `All touches inside ${plan[0]?.window ?? "business hours"}, max one touch per lead per day.`,
          packet: mk(stages[2],
            `Approve Schedule: touches inside ${plan[0]?.window ?? "business hours"}, one per lead per day.`,
            [{ title: "Confirm send windows and pacing" }]),
        },
        {
          stage: stages[3],
          title: "Send approval (blocked until prior approvals)",
          description:
            "Final authorisation to start the sequence. Created blocked — becomes actionable only after Audience, Sequence and Schedule approvals.",
          packet: mk(stages[3],
            `Authorise starting the sequence for ${anyEligible.size} lead(s). Requires all prior stage approvals.`,
            [{ title: "Start the approved sequence" }]),
        },
      ],
    })),
    audienceSummary,
  };
}

// ── 3. WhatsApp campaign ─────────────────────────────────────────────────────
export interface WhatsAppWorkOrderOptions {
  audience?: AudienceFilterOptions;
  templateName?: string | null;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createWhatsAppCampaignWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: WhatsAppWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; providerConnected: boolean; audienceSummary: string }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");

  // Provider resolution — real connection rows, honest blocker when absent.
  const { data: wati } = await sb.from("wati_connections")
    .select("workspace_id, tenant_id, api_host, status, last_tested_at, error_message")
    .eq("workspace_id", workspaceId).maybeSingle();
  const providerConnected = !!wati;
  const integrationBlockers = providerConnected ? [] : [{
    kind: "integration_missing" as const,
    detail: "No WhatsApp provider connected (WATI). Connect a provider in WhatsApp settings before this campaign can proceed.",
  }];

  // Templates — synced, with approval status (only approved templates sendable).
  const { data: templates } = await sb.from("wati_templates")
    .select("id, name, status, category, body")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false }).limit(50);
  const approvedTemplates = (templates ?? []).filter((t: any) =>
    String(t.status ?? "").toLowerCase().includes("approved"));
  const matchedTemplate = opts.templateName
    ? (templates ?? []).find((t: any) =>
        String(t.name ?? "").toLowerCase() === opts.templateName!.toLowerCase()) ?? null
    : null;

  const filter = opts.audience ?? {};
  const rawLeads = await loadAudienceLeads(sb, workspaceId, filter);
  const compliance = filterAudienceForChannel(rawLeads, "whatsapp");

  const stages = approvalStagesForChannel("whatsapp");
  const targets: PacketTarget[] = [{
    domain: "comms",
    entity_type: "whatsapp_campaign",
    entity_id: null,
    entity_name: "Proposed WhatsApp campaign",
    resolved: true,
    resolution_note: `${compliance.eligible.length} opted-in lead(s); provider ${providerConnected ? "connected (WATI)" : "NOT connected"}.`,
  }];
  const countries = summariseCountryDistribution(compliance.eligible.map((l) => l.phone));
  const cost = estimateWhatsAppCampaignCost(compliance.eligible.length);
  const evidence: PacketEvidence[] = [
    audienceEvidence(evidenceItem, compliance, filter),
    evidenceItem("wati_connections",
      providerConnected
        ? `WATI connection present (tenant ${wati.tenant_id}, status "${wati.status}"` +
          `${wati.last_tested_at ? `, last tested ${wati.last_tested_at}` : ", never tested"}). ` +
          "Sending WhatsApp number is managed inside the WATI tenant and is not stored in WEBEE — " +
          "confirm the sender number in WATI before Send approval."
        : "No WATI connection found.",
      providerConnected
        ? {
            connected: true,
            tenant_id: wati.tenant_id,
            api_host: wati.api_host ?? null,
            status: wati.status,
            last_tested_at: wati.last_tested_at ?? null,
            error_message: wati.error_message ?? null,
            sender_number_known: false,
          }
        : { connected: false }),
    evidenceItem("leads",
      `Destination country mix for the ${compliance.eligible.length} eligible number(s): ${countries.summary}.`,
      { by_country: countries.byCountry, unknown_prefix: countries.unknown }),
    evidenceItem("cost_estimate", cost.note, {
      messages: cost.messages,
      per_message_low: cost.perMessageLow,
      per_message_high: cost.perMessageHigh,
      total_low: cost.totalLow,
      total_high: cost.totalHigh,
      assumption: true,
    }),
    evidenceItem("wati_templates",
      `${(templates ?? []).length} synced template(s); ${approvedTemplates.length} approved.` +
      (opts.templateName ? (matchedTemplate ? ` Requested template "${matchedTemplate.name}" found (status: ${matchedTemplate.status}).` : ` Requested template "${opts.templateName}" NOT found.`) : ""),
      {
        total: (templates ?? []).length,
        approved: approvedTemplates.length,
        approved_names: approvedTemplates.slice(0, 10).map((t: any) => t.name),
        requested: opts.templateName ?? null,
        requested_found: !!matchedTemplate,
      }),
  ];
  const diagnosis =
    `WhatsApp campaign feasibility: ${compliance.eligible.length} of ${rawLeads.length} lead(s) are opted-in and reachable; ` +
    `${approvedTemplates.length} approved template(s) available; provider ${providerConnected ? "connected" : "missing — campaign blocked until connected"}. ` +
    `Volume: ${compliance.eligible.length} message(s); estimated cost ${cost.totalLow}–${cost.totalHigh} GBP (assumed rate). ` +
    `Countries: ${countries.summary}.`;
  const objective = opts.objective?.trim() ||
    "Send a WhatsApp template campaign to the opted-in lead segment with split Audience/Template/Schedule/Follow-Up/Send approvals.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_whatsapp_campaign_work_order" : "manual:whatsapp_work_order";
  const limitations = [
    "Only leads with explicit WhatsApp opt-in are ever included — no exceptions.",
    "Only provider-approved templates can be sent.",
    "Sending requires ALL stage approvals plus a connected provider.",
  ];

  const mk = (stage: ApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    stagePacket({
      buildIntelligencePacket, objective, intentSource,
      instruction: opts.instruction, stage, allStages: stages,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the WhatsApp campaign`],
      successCriteria: ["Zero messages to non-opted-in numbers", "Only approved templates used"],
      limitations, approvalSummary: summary, integrationBlockers,
      costNote: cost.note,
    });

  const result = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "WhatsApp template campaign",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "whatsapp", provider_connected: providerConnected },
    packet: mk(stages[0], `Approve WhatsApp audience: ${compliance.eligible.length} opted-in lead(s).`, [{ title: "Confirm opted-in audience" }]),
    readiness: providerConnected ? "ready_for_change_approval" : "integration_required",
    triggerType: "whatsapp_campaign",
    stageTasks: [
      {
        stage: stages[0],
        title: `Approve Audience: ${compliance.eligible.length} opted-in lead(s)`,
        description: compliance.summary,
        packet: mk(stages[0], `Approve Audience: ${compliance.eligible.length} opted-in lead(s). ${compliance.summary}.`, [{ title: "Confirm the opted-in audience" }]),
      },
      {
        stage: stages[1],
        title: matchedTemplate
          ? `Approve Template: "${matchedTemplate.name}" (${matchedTemplate.status})`
          : `Approve Template: choose from ${approvedTemplates.length} approved template(s)`,
        description: matchedTemplate
          ? `Requested template resolved against synced WATI templates (status: ${matchedTemplate.status}).`
          : `${approvedTemplates.length} approved template(s) available: ${approvedTemplates.slice(0, 5).map((t: any) => t.name).join(", ") || "none"}.`,
        packet: mk(stages[1],
          matchedTemplate
            ? `Approve Template "${matchedTemplate.name}" for this campaign (only provider-approved templates send).`
            : `Approve the template selection (${approvedTemplates.length} approved available).`,
          [{ title: "Confirm the template to send" }]),
      },
      {
        stage: stages[2],
        title: "Approve Schedule: send window, pacing and country rules",
        description:
          `Business-hours send window, paced sending, no repeats to the same number. Destination mix: ${countries.summary}.` +
          (countries.unknown ? " Numbers without a recognised country prefix must have their local-time rules confirmed here." : ""),
        packet: mk(stages[2],
          `Approve Schedule: business-hours window, paced sending, one message per lead. Country mix: ${countries.summary}.`,
          [{ title: "Confirm send window, pacing and per-country timing rules" }]),
      },
      {
        stage: stages[3],
        title: "Approve Follow-Up: reply handling and follow-up policy",
        description:
          "How replies are handled and whether any follow-up touches are allowed after the initial template. " +
          "Any follow-up sequence needs its own Audience/Sequence/Schedule/Send approvals — this stage only fixes the policy.",
        packet: mk(stages[3],
          "Approve Follow-Up policy: reply routing and whether follow-up touches are permitted (any actual sequence requires its own approvals).",
          [{ title: "Confirm reply handling and follow-up policy" }]),
      },
      {
        stage: stages[4],
        title: "Send approval (blocked until prior approvals)",
        description:
          `Final authorisation. Created blocked — requires Audience, Template, Schedule and Follow-Up approvals plus a connected provider. ` +
          `Volume ${compliance.eligible.length} message(s); ${cost.note}`,
        packet: mk(stages[4], `Authorise sending to ${compliance.eligible.length} opted-in lead(s) via WATI. Requires all prior approvals.`, [{ title: "Send the approved campaign" }]),
      },
    ],
  });
  return { ...result, providerConnected, audienceSummary: compliance.summary };
}

// ── 4. Email campaign ────────────────────────────────────────────────────────
export interface EmailWorkOrderOptions {
  audience?: AudienceFilterOptions;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createEmailCampaignWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: EmailWorkOrderOptions = {},
): Promise<{ workOrder: any; tasks: any[]; deliverability: { score: number; grade: string; issues: string[] } | null; audienceSummary: string }> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");

  // Deliverability readiness — real DNS/mailbox health, no domain = blocker.
  const { getEmailReadinessForWorkspace } = await import("@/lib/hexmail/deliverability.server");
  const readiness = await getEmailReadinessForWorkspace(workspaceId);
  const integrationBlockers = readiness ? [] : [{
    kind: "integration_missing" as const,
    detail: "No verified sender domain configured. Add a sender domain in HexMail → Deliverability before email campaigns can proceed.",
  }];

  const suppressedEmails = await loadSuppressedEmails(sb, workspaceId);
  const filter = opts.audience ?? {};
  const rawLeads = await loadAudienceLeads(sb, workspaceId, filter);
  const compliance = filterAudienceForChannel(rawLeads, "email", { suppressedEmails });

  // Existing HexMail campaigns for sequence reuse (evidence only).
  const { data: hexCampaigns } = await sb.from("hexmail_campaigns")
    .select("id, name, status")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false }).limit(10);

  const stages = approvalStagesForChannel("email");
  const targets: PacketTarget[] = [{
    domain: "comms",
    entity_type: "email_campaign",
    entity_id: null,
    entity_name: "Proposed email campaign",
    resolved: true,
    resolution_note: `${compliance.eligible.length} eligible recipient(s) after suppression/dedup; sender domain ${readiness ? `health ${readiness.score}/100 (${readiness.grade})` : "missing"}.`,
  }];
  const evidence: PacketEvidence[] = [
    audienceEvidence(evidenceItem, compliance, filter),
    evidenceItem("email_sender_domains",
      readiness
        ? `Sender domain health ${readiness.score}/100 (grade ${readiness.grade})${readiness.issues.length ? `; issues: ${readiness.issues.join("; ")}` : ""}.`
        : "No verified sender domain configured.",
      readiness ? { score: readiness.score, grade: readiness.grade, issues: readiness.issues } : { configured: false }),
    evidenceItem("suppressed_emails", `${suppressedEmails.length} suppressed address(es) enforced.`, { count: suppressedEmails.length }),
    evidenceItem("hexmail_campaigns", `${(hexCampaigns ?? []).length} existing HexMail campaign(s) available as sequence sources.`, {
      campaigns: (hexCampaigns ?? []).map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
    }),
  ];
  const diagnosis =
    `Email campaign feasibility: ${compliance.eligible.length} of ${rawLeads.length} lead(s) reachable after suppression and dedup; ` +
    (readiness
      ? `sender domain health ${readiness.score}/100 (${readiness.grade}).`
      : "no verified sender domain — campaign blocked until deliverability is set up.");
  const objective = opts.objective?.trim() ||
    "Run an email campaign to the eligible lead segment with split Audience/Copy/Sequence/Schedule/Send approvals and suppression enforcement.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_email_campaign_work_order" : "manual:email_work_order";
  const limitations = [
    "Suppressed and unsubscribed addresses are excluded and cannot be re-added by approvals.",
    "Send gate (domain status, DNS, daily mailbox limits) is re-checked at send time.",
    "Sending requires ALL stage approvals plus a healthy verified sender domain.",
  ];

  const mk = (stage: ApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    stagePacket({
      buildIntelligencePacket, objective, intentSource,
      instruction: opts.instruction, stage, allStages: stages,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the email campaign`],
      successCriteria: ["Zero sends to suppressed addresses", "Send gate passes at send time"],
      limitations, approvalSummary: summary, integrationBlockers,
    });

  const result = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: "Email campaign",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "email", sender_domain_configured: !!readiness },
    packet: mk(stages[0], `Approve email audience: ${compliance.eligible.length} eligible recipient(s).`, [{ title: "Confirm eligible audience" }]),
    readiness: readiness ? "ready_for_change_approval" : "integration_required",
    triggerType: "email_campaign",
    stageTasks: [
      {
        stage: stages[0],
        title: `Approve Audience: ${compliance.eligible.length} eligible recipient(s)`,
        description: compliance.summary + ` ${suppressedEmails.length} suppressed address(es) enforced.`,
        packet: mk(stages[0], `Approve Audience: ${compliance.eligible.length} recipient(s). ${compliance.summary}.`, [{ title: "Confirm the filtered audience" }]),
      },
      {
        stage: stages[1],
        title: "Approve Copy: campaign email content",
        description: "Email copy drafted/selected for this campaign — approving copy never authorises sending.",
        packet: mk(stages[1], "Approve Copy for this campaign. Approving copy does NOT authorise sending.", [{ title: "Review and approve the email copy" }]),
      },
      {
        stage: stages[2],
        title: `Approve Sequence: steps and stop conditions`,
        description: `Sequence built from HexMail campaign steps (${(hexCampaigns ?? []).length} existing campaign(s) available). Stop conditions: ${SEQUENCE_STOP_CONDITIONS.join("; ")}.`,
        packet: mk(stages[2], "Approve Sequence: step order, gaps and stop conditions.", [{ title: "Confirm sequence steps and stop conditions" }]),
      },
      {
        stage: stages[3],
        title: "Approve Schedule: send window and daily limits",
        description: "Business-hours window; mailbox daily limits enforced by the send gate.",
        packet: mk(stages[3], "Approve Schedule: send window and pacing within mailbox daily limits.", [{ title: "Confirm schedule" }]),
      },
      {
        stage: stages[4],
        title: "Send approval (blocked until prior approvals)",
        description: "Final authorisation. Created blocked — requires Audience, Copy, Sequence and Schedule approvals plus a passing send gate.",
        packet: mk(stages[4], `Authorise sending to ${compliance.eligible.length} recipient(s). Requires all prior approvals and a passing send gate.`, [{ title: "Send the approved campaign" }]),
      },
    ],
  });
  return { ...result, deliverability: readiness, audienceSummary: compliance.summary };
}

// ── 5. Call campaign ─────────────────────────────────────────────────────────
export interface CallCampaignWorkOrderOptions {
  agentName?: string | null;
  audience?: AudienceFilterOptions;
  dailyVolume?: number | null;
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createCallCampaignWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: CallCampaignWorkOrderOptions = {},
): Promise<{
  workOrder: any; tasks: any[];
  agent: { id: string; name: string; deployed: boolean } | null;
  agentStatus: "resolved" | "ambiguous" | "not_found" | "none_requested";
  agentCandidates: Array<{ id: string; name: string; deployed: boolean }>;
  audienceSummary: string;
}> {
  await guards(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } =
    await import("@/lib/minds/intelligence-packet.server");

  // Agent resolution against REAL workspace agents.
  const { data: agents } = await sb.from("agents")
    .select("id, name, status, settings, retell_agent_id")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false }).limit(100);
  const agentList = ((agents ?? []) as any[]).map((a) => ({
    id: a.id as string,
    name: (a.name ?? "Unnamed agent") as string,
    deployed: !!((a.settings as any)?.deployedRetellAgentId || a.retell_agent_id),
  }));
  let agent: { id: string; name: string; deployed: boolean } | null = null;
  let agentStatus: "resolved" | "ambiguous" | "not_found" | "none_requested" = "none_requested";
  let agentCandidates: typeof agentList = [];
  if (opts.agentName?.trim()) {
    const q = opts.agentName.trim().toLowerCase();
    const matches = agentList.filter((a) => a.name.toLowerCase() === q);
    const partial = matches.length ? matches : agentList.filter((a) => a.name.toLowerCase().includes(q));
    if (partial.length === 1) { agent = partial[0]; agentStatus = "resolved"; }
    else if (partial.length > 1) { agentStatus = "ambiguous"; agentCandidates = partial.slice(0, 8); }
    else { agentStatus = "not_found"; agentCandidates = agentList.slice(0, 10); }
  } else if (agentList.length === 1) {
    agent = agentList[0]; agentStatus = "resolved";
  }
  // Ambiguity is a caller decision — return early WITHOUT creating records.
  if (agentStatus === "ambiguous" || agentStatus === "not_found") {
    return { workOrder: null, tasks: [], agent: null, agentStatus, agentCandidates, audienceSummary: "" };
  }
  const integrationBlockers = !agentList.length ? [{
    kind: "integration_missing" as const,
    detail: "No AI voice agents exist in this workspace. Build an agent in the Builder before a call campaign can run.",
  }] : (agent && !agent.deployed ? [{
    kind: "other" as const,
    detail: `Agent "${agent.name}" is not deployed — deploy it before launching the campaign.`,
  }] : []);

  const filter = opts.audience ?? {};
  const rawLeads = await loadAudienceLeads(sb, workspaceId, filter);
  const compliance = filterAudienceForChannel(rawLeads, "call");
  const dailyVolume = Math.min(500, Math.max(1, Math.round(opts.dailyVolume ?? 50)));

  const stages = approvalStagesForChannel("call");
  const targets: PacketTarget[] = [
    {
      domain: "voice",
      entity_type: "call_campaign",
      entity_id: null,
      entity_name: "Proposed AI call campaign",
      resolved: true,
      resolution_note: `${compliance.eligible.length} callable lead(s); agent ${agent ? `"${agent.name}" resolved` : "to be selected at Agent & Script approval"}.`,
    },
    ...(agent ? [{
      domain: "voice" as const,
      entity_type: "agent",
      entity_id: agent.id,
      entity_name: agent.name,
      resolved: true,
      resolution_note: agent.deployed ? "Deployed agent resolved from workspace agents." : "Agent found but NOT deployed.",
    }] : []),
  ];
  const evidence: PacketEvidence[] = [
    audienceEvidence(evidenceItem, compliance, filter),
    evidenceItem("agents",
      `${agentList.length} agent(s) in workspace; ${agentList.filter((a) => a.deployed).length} deployed.` +
      (agent ? ` Selected: "${agent.name}" (${agent.deployed ? "deployed" : "not deployed"}).` : ""),
      { total: agentList.length, deployed: agentList.filter((a) => a.deployed).length, selected: agent }),
  ];
  const diagnosis =
    `Call campaign feasibility: ${compliance.eligible.length} of ${rawLeads.length} lead(s) callable (Do-Not-Call and no-phone excluded); ` +
    (agent ? `agent "${agent.name}" ${agent.deployed ? "is deployed and ready" : "exists but is NOT deployed"}; ` : "agent selection pending; ") +
    `proposed volume ${dailyVolume} call(s)/day.`;
  const objective = opts.objective?.trim() ||
    "Run an AI call campaign over the callable lead segment with split Audience/Agent & Script/Schedule/Volume/Launch approvals.";
  const intentSource = opts.source === "hivemind_tool" ? "chat_tool:create_call_campaign_work_order" : "manual:call_campaign_work_order";
  const limitations = [
    "Do-Not-Call leads are excluded and cannot be re-added by approvals.",
    "Calls only inside the approved schedule window; retry/voicemail policy per the Schedule approval.",
    "Launch requires ALL stage approvals and a deployed agent.",
  ];

  const mk = (stage: ApprovalStage, summary: string, planSteps: Array<{ title: string }>) =>
    stagePacket({
      buildIntelligencePacket, objective, intentSource,
      instruction: opts.instruction, stage, allStages: stages,
      targets, evidence, diagnosis, planSteps,
      deliverables: [`${stage.label} approval for the call campaign`],
      successCriteria: ["Zero calls to Do-Not-Call leads", "Daily volume cap respected"],
      limitations, approvalSummary: summary, integrationBlockers,
    });

  const result = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: agent ? `AI call campaign — ${agent.name}` : "AI call campaign",
    objective,
    source: opts.source ?? "hivemind_chat",
    metadata: { channel_kind: "call", agent_id: agent?.id ?? null, daily_volume: dailyVolume },
    packet: mk(stages[0], `Approve call audience: ${compliance.eligible.length} callable lead(s).`, [{ title: "Confirm callable audience" }]),
    readiness: !agentList.length ? "integration_required" : (integrationBlockers.length ? "blocked" : "ready_for_change_approval"),
    triggerType: "call_campaign",
    stageTasks: [
      {
        stage: stages[0],
        title: `Approve Audience: ${compliance.eligible.length} callable lead(s)`,
        description: compliance.summary,
        packet: mk(stages[0], `Approve Audience: ${compliance.eligible.length} callable lead(s). ${compliance.summary}.`, [{ title: "Confirm the callable audience" }]),
      },
      {
        stage: stages[1],
        title: agent ? `Approve Agent & Script: "${agent.name}"` : "Approve Agent & Script: select the calling agent",
        description: agent
          ? `Agent "${agent.name}" (${agent.deployed ? "deployed" : "NOT deployed"}) and its current script/flow.`
          : `Select from ${agentList.length} workspace agent(s) (${agentList.filter((a) => a.deployed).length} deployed).`,
        packet: mk(stages[1],
          agent ? `Approve Agent & Script: agent "${agent.name}" with its current flow.` : "Approve Agent & Script: select and approve the calling agent and script.",
          [{ title: "Confirm the agent and script" }]),
      },
      {
        stage: stages[2],
        title: "Approve Schedule: call window, retries, voicemail policy",
        description: "Business-hours call window, retry policy and voicemail behaviour.",
        packet: mk(stages[2], "Approve Schedule: call window, retry and voicemail policy.", [{ title: "Confirm the calling schedule" }]),
      },
      {
        stage: stages[3],
        title: `Approve Volume: up to ${dailyVolume} call(s)/day`,
        description: `Daily volume cap ${dailyVolume}; total audience ${compliance.eligible.length} lead(s).`,
        packet: mk(stages[3], `Approve Volume: up to ${dailyVolume} call(s)/day across ${compliance.eligible.length} lead(s).`, [{ title: "Confirm daily call volume" }]),
      },
      {
        stage: stages[4],
        title: "Launch approval (blocked until prior approvals)",
        description: "Final authorisation. Created blocked — requires Audience, Agent & Script, Schedule and Volume approvals plus a deployed agent.",
        packet: mk(stages[4], `Authorise launching the campaign (${compliance.eligible.length} lead(s), ${dailyVolume}/day). Requires all prior approvals.`, [{ title: "Launch the approved campaign" }]),
      },
    ],
  });
  return { ...result, agent, agentStatus: agent ? "resolved" : agentStatus, agentCandidates, audienceSummary: compliance.summary };
}
