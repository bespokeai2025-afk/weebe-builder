/**
 * HiveMind cross-channel orchestration — Task #490 (section 21).
 *
 * One cross-channel objective (e.g. "Generate more WEBEE Receptionist leads
 * in the UK") produces ONE parent work order carrying the channel strategy,
 * shared success criteria and reporting plan — plus child channel tasks that
 * are:
 *  - evidence-justified: a channel only gets a task when REAL workspace data
 *    supports it (contactable audience, connected provider, deployed agent…);
 *    unjustified channels are reported as skipped with the reason, never
 *    padded into ten disconnected generic tasks;
 *  - packet-backed: every child task carries its own intelligence packet with
 *    channel-specific evidence and its own approval scope;
 *  - dependency-linked: child channel tasks depend on the strategy task via
 *    the `dependencies` column;
 *  - launch-safe: every channel's launch/send is blocked behind its own
 *    approval — approving the strategy never authorises sending.
 *
 * WBAH is excluded entirely (no contact-generating orchestration).
 */
import type {
  PacketEvidence,
  PacketTarget,
} from "@/lib/minds/intelligence-packet.shared";

type Sb = any;

export const CROSS_CHANNEL_KEYS = ["email", "whatsapp", "calls", "social", "seo"] as const;
export type CrossChannelKey = (typeof CROSS_CHANNEL_KEYS)[number];

export interface ChannelJustification {
  channel: CrossChannelKey;
  justified: boolean;
  reason: string;
  evidence: PacketEvidence[];
  data: Record<string, unknown>;
}

const CHANNEL_LABELS: Record<CrossChannelKey, string> = {
  email: "Email outreach",
  whatsapp: "WhatsApp outreach",
  calls: "AI voice calls",
  social: "Social content",
  seo: "SEO content",
};

/** Gather REAL per-channel evidence; decide justification honestly. */
export async function assessChannelEvidence(
  sb: Sb,
  workspaceId: string,
  evidenceItem: (s: string, d: string, data?: Record<string, unknown> | null) => PacketEvidence,
): Promise<ChannelJustification[]> {
  const out: ChannelJustification[] = [];

  // Shared audience read (real leads rows).
  const { data: leadRows, error: leadErr } = await sb.from("leads")
    .select("id, email, phone, whatsapp_opt_in, status")
    .eq("workspace_id", workspaceId)
    .limit(2000);
  if (leadErr) throw new Error(`Lead audience could not be loaded: ${leadErr.message}`);
  const leads: any[] = leadRows ?? [];

  // Email: contactable emails minus suppression list (fail loud on suppression).
  // suppressed_emails is a global list (no workspace_id column).
  const { data: suppRows, error: suppErr } = await sb.from("suppressed_emails")
    .select("email").limit(5000);
  if (suppErr) throw new Error(`Suppression list could not be loaded (${suppErr.message}); refusing to plan email outreach without it.`);
  const suppressed = new Set((suppRows ?? []).map((r: any) => String(r.email).toLowerCase()));
  const emailable = leads.filter((l) => l.email && !suppressed.has(String(l.email).toLowerCase()));
  out.push({
    channel: "email",
    justified: emailable.length > 0,
    reason: emailable.length > 0
      ? `${emailable.length} contactable lead(s) with non-suppressed email addresses.`
      : `No contactable email audience (${leads.length} lead(s), ${suppressed.size} suppressed).`,
    evidence: [evidenceItem("leads",
      `Email audience: ${emailable.length} eligible of ${leads.length} lead(s); ${suppressed.size} suppressed address(es) excluded.`,
      { eligible: emailable.length, total: leads.length, suppressed: suppressed.size })],
    data: { eligible: emailable.length },
  });

  // WhatsApp: explicit opt-in + phone AND a configured provider.
  const optedIn = leads.filter((l) => l.whatsapp_opt_in === true && l.phone);
  const { data: wsRow } = await sb.from("workspace_settings")
    .select("whatsapp_provider, twilio_account_sid, whatsapp_phone_id, meta_phone_number_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const waProviderConfigured = !!(wsRow?.whatsapp_provider &&
    (wsRow.twilio_account_sid || wsRow.whatsapp_phone_id || wsRow.meta_phone_number_id));
  out.push({
    channel: "whatsapp",
    justified: optedIn.length > 0 && waProviderConfigured,
    reason: !waProviderConfigured
      ? "No WhatsApp provider is configured for this workspace."
      : optedIn.length > 0
        ? `${optedIn.length} lead(s) with explicit WhatsApp opt-in and phone numbers; provider "${wsRow.whatsapp_provider}" configured.`
        : "No leads have explicit WhatsApp opt-in — consent-gated channel cannot be justified.",
    evidence: [evidenceItem("leads/workspace_settings",
      `WhatsApp: ${optedIn.length} opted-in lead(s); provider ${waProviderConfigured ? `"${wsRow.whatsapp_provider}" configured` : "not configured"}.`,
      { opted_in: optedIn.length, provider_configured: waProviderConfigured })],
    data: { opted_in: optedIn.length, provider_configured: waProviderConfigured },
  });

  // Calls: a deployed voice agent + callable phone numbers.
  const { data: agentRows } = await sb.from("agents")
    .select("id, name, retell_agent_id, agent_type")
    .eq("workspace_id", workspaceId)
    .limit(50);
  const deployed = (agentRows ?? []).filter((a: any) => a.retell_agent_id);
  const callable = leads.filter((l) => l.phone);
  out.push({
    channel: "calls",
    justified: deployed.length > 0 && callable.length > 0,
    reason: deployed.length === 0
      ? "No deployed voice agent exists in this workspace."
      : callable.length === 0
        ? "No leads carry phone numbers."
        : `${deployed.length} deployed agent(s) (e.g. "${deployed[0].name}") and ${callable.length} lead(s) with phone numbers.`,
    evidence: [evidenceItem("agents/leads",
      `Calls: ${deployed.length} deployed agent(s); ${callable.length} callable lead(s).`,
      { deployed_agents: deployed.map((a: any) => ({ id: a.id, name: a.name })), callable: callable.length })],
    data: { deployed: deployed.length, callable: callable.length },
  });

  // Social: verified social connections.
  const { data: socialRows } = await sb.from("growthmind_social_connections")
    .select("id, platform, status")
    .eq("workspace_id", workspaceId)
    .limit(20);
  const activeSocial = (socialRows ?? []).filter((c: any) => c.status === "connected" || c.status === "active" || c.status === "verified");
  out.push({
    channel: "social",
    justified: activeSocial.length > 0,
    reason: activeSocial.length > 0
      ? `${activeSocial.length} connected social account(s): ${activeSocial.map((c: any) => c.platform).join(", ")}.`
      : "No connected social accounts.",
    evidence: [evidenceItem("growthmind_social_connections",
      `Social: ${activeSocial.length} connected account(s) of ${(socialRows ?? []).length} total.`,
      { connections: (socialRows ?? []).map((c: any) => ({ platform: c.platform, status: c.status })) })],
    data: { connected: activeSocial.length },
  });

  // SEO: an active Google Search Console sync.
  const { data: gscRows } = await sb.from("growthmind_gsc_sync_state")
    .select("id, site_url, status, last_synced_at")
    .eq("workspace_id", workspaceId)
    .limit(5);
  const gsc = (gscRows ?? [])[0] ?? null;
  const gscActive = !!gsc && gsc.status !== "disconnected";
  out.push({
    channel: "seo",
    justified: gscActive,
    reason: gscActive
      ? `Google Search Console connected for ${gsc.site_url} (last synced ${gsc.last_synced_at ?? "never"}).`
      : "Google Search Console is not connected — SEO channel has no measurable foundation.",
    evidence: [evidenceItem("growthmind_gsc_sync_state",
      gscActive ? `SEO: GSC connected for ${gsc.site_url}.` : "SEO: no GSC connection.",
      { connected: gscActive, site_url: gsc?.site_url ?? null })],
    data: { connected: gscActive },
  });

  return out;
}

export interface CrossChannelOptions {
  objective: string;
  instruction?: string | null;
  /** Restrict to a subset of channels (still evidence-gated). */
  channels?: CrossChannelKey[] | null;
  source?: string;
}

export async function createCrossChannelObjectiveWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  opts: CrossChannelOptions,
): Promise<{
  workOrder: any;
  strategyTask: any;
  channelTasks: any[];
  justified: ChannelJustification[];
  skipped: ChannelJustification[];
}> {
  const objective = (opts.objective ?? "").trim();
  if (objective.length < 10) throw new Error("A specific cross-channel objective is required (at least 10 characters).");

  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem, prepareMindTaskInsert } =
    await import("@/lib/minds/intelligence-packet.server");

  const requested = new Set(opts.channels?.length ? opts.channels : CROSS_CHANNEL_KEYS);
  const assessments = (await assessChannelEvidence(sb, workspaceId, evidenceItem))
    .filter((a) => requested.has(a.channel));
  const justified = assessments.filter((a) => a.justified);
  const skipped = assessments.filter((a) => !a.justified);

  const sharedSuccessCriteria = [
    `Objective progress measured weekly against: ${objective}`,
    "Each channel reports leads/replies attributable to this work order",
    "Combined reporting reviewed at the shared 7-day reassessment",
  ];
  const reportingPlan = "Single shared report on the parent work order: per-channel sends/publishes, replies, opt-outs/failures and attributed leads, reviewed every 7 days.";

  const allEvidence: PacketEvidence[] = assessments.flatMap((a) => a.evidence);
  const strategyDiagnosis =
    `Channel assessment from real workspace data: ${justified.length ? `justified — ${justified.map((j) => `${j.channel} (${j.reason})`).join("; ")}` : "no channel is currently justified"}. ` +
    (skipped.length ? `Skipped — ${skipped.map((s) => `${s.channel}: ${s.reason}`).join("; ")}` : "");

  const parentTargets: PacketTarget[] = [{
    domain: "marketing",
    entity_type: "cross_channel_objective",
    entity_id: workspaceId,
    entity_name: objective.slice(0, 120),
    resolved: true,
  }];

  const parentPacket = buildIntelligencePacket({
    mind: "hivemind",
    objective,
    intentSource: opts.source ?? "chat_tool:create_cross_channel_objective_work_order",
    instruction: opts.instruction ?? null,
    targets: parentTargets,
    evidence: allEvidence,
    diagnosis: strategyDiagnosis,
    planSteps: [
      { title: "Channel strategy approval", detail: `Approve the evidence-justified channel mix: ${justified.map((j) => CHANNEL_LABELS[j.channel]).join(", ") || "none currently justified"}.` },
      ...justified.map((j) => ({
        title: `${CHANNEL_LABELS[j.channel]} execution`,
        detail: `${j.reason} Channel work runs as its own packet-backed task with its own approval; launch is blocked until that approval.`,
      })),
      { title: "Shared reporting", detail: reportingPlan },
    ],
    deliverables: [
      "Approved channel strategy with per-channel justification",
      ...justified.map((j) => `${CHANNEL_LABELS[j.channel]} channel plan (own approval)`),
      "Shared cross-channel report",
    ],
    successCriteria: sharedSuccessCriteria,
    limitations: [
      "Only evidence-justified channels receive tasks — skipped channels are listed with reasons, never padded with generic tasks.",
      "Approving the strategy never authorises any send/publish; each channel keeps its own blocked launch approval.",
    ],
    approvalScope: {
      kind: "analysis",
      summary: `Approve the cross-channel strategy for "${objective}" (${justified.length} justified channel(s), ${skipped.length} skipped).`,
      sensitive: false,
    },
    monitoring: { metrics: ["attributed_leads", "replies", "opt_outs", "per_channel_progress"], reassess_after_days: 7 },
    blockers: justified.length === 0
      ? [{ kind: "other", detail: "No channel is currently evidence-justified — connect a provider or build an audience before this objective can proceed." }]
      : [],
  });

  // ONE parent work order.
  const { data: wo, error: we } = await sb.from("work_orders").insert({
    workspace_id: workspaceId,
    title: `Cross-channel objective: ${objective.slice(0, 140)}`,
    objective,
    status: "open",
    source: opts.source ?? "hivemind_chat",
    created_by_user_id: userId,
    assigned_minds: ["hivemind"],
    metadata: {
      orchestration_kind: "cross_channel_objective",
      justified_channels: justified.map((j) => j.channel),
      skipped_channels: skipped.map((s) => ({ channel: s.channel, reason: s.reason })),
      shared_success_criteria: sharedSuccessCriteria,
      reporting_plan: reportingPlan,
    },
    intelligence_packet: parentPacket,
    readiness_state: justified.length === 0 ? "blocked" : "ready_for_analysis_approval",
    packet_version: parentPacket.version,
  }).select("*").single();
  if (we) throw we;

  const inserted: any[] = [];
  try {
    // Strategy/coordination task first — children depend on it.
    const strategyRow = prepareMindTaskInsert({
      workspace_id: workspaceId,
      title: `Channel strategy: ${objective.slice(0, 120)}`,
      description: strategyDiagnosis,
      status: "suggested",
      priority: "high",
      source: "work_order",
      trigger_type: "cross_channel_objective",
      task_category: "informational",
      assigned_mind: "hivemind",
      work_order_id: wo.id,
      metadata: { orchestration_role: "strategy", approval_stage: "channel_strategy", approval_stage_label: "Channel Strategy", final_send_stage: false },
    }, parentPacket);
    const { data: strategyTask, error: se } = await sb.from("hivemind_tasks")
      .insert(strategyRow).select("*").single();
    if (se) throw se;
    inserted.push(strategyTask);

    // Child channel tasks — dependency-linked to the strategy task.
    const channelTasks: any[] = [];
    for (const j of justified) {
      const childPacket = buildIntelligencePacket({
        mind: "hivemind",
        objective: `${CHANNEL_LABELS[j.channel]} contribution to: ${objective}`,
        intentSource: opts.source ?? "chat_tool:create_cross_channel_objective_work_order",
        instruction: opts.instruction ?? null,
        targets: [{
          domain: "marketing",
          entity_type: `${j.channel}_channel_plan`,
          entity_id: workspaceId,
          entity_name: CHANNEL_LABELS[j.channel],
          resolved: true,
        }],
        evidence: j.evidence,
        diagnosis: `${j.reason} This channel task exists ONLY because that evidence justifies it.`,
        planSteps: [
          { title: "Channel plan", detail: `Build the ${CHANNEL_LABELS[j.channel].toLowerCase()} plan through the existing ${j.channel} work-order flow (its own staged approvals).` },
          { title: "Launch (own approval)", detail: "Launch/send is blocked behind this channel's own final approval — never authorised by the strategy approval." },
          { title: "Report into shared reporting", detail: reportingPlan },
        ],
        deliverables: [`${CHANNEL_LABELS[j.channel]} channel plan and post-launch metrics into the shared report`],
        successCriteria: sharedSuccessCriteria,
        limitations: [
          "Proposal only — launching this channel requires its own approval chain.",
        ],
        approvalScope: {
          kind: "analysis",
          summary: `Approve the ${CHANNEL_LABELS[j.channel].toLowerCase()} channel plan for "${objective}".`,
          sensitive: false,
        },
        monitoring: { metrics: ["attributed_leads", "replies", "opt_outs"], reassess_after_days: 7 },
        blockers: [{ kind: "other", detail: "Awaiting channel strategy approval — channel work starts only after the strategy task is approved." }],
      });
      const childRow = prepareMindTaskInsert({
        workspace_id: workspaceId,
        title: `${CHANNEL_LABELS[j.channel]}: ${objective.slice(0, 110)}`,
        description: `${j.reason} Runs as its own packet-backed channel plan with separate approvals; reports into the shared cross-channel report.`,
        status: "suggested",
        priority: "medium",
        source: "work_order",
        trigger_type: "cross_channel_objective",
        task_category: "informational",
        assigned_mind: "hivemind",
        work_order_id: wo.id,
        dependencies: [String(strategyTask.id)],
        metadata: {
          orchestration_role: "channel",
          channel: j.channel,
          approval_stage: `${j.channel}_channel_plan`,
          approval_stage_label: `${CHANNEL_LABELS[j.channel]} Plan`,
          final_send_stage: false,
          channel_evidence: j.data,
        },
      }, childPacket);
      const { data: childTask, error: ce } = await sb.from("hivemind_tasks")
        .insert(childRow).select("*").single();
      if (ce) throw ce;
      inserted.push(childTask);
      channelTasks.push(childTask);
    }

    return { workOrder: wo, strategyTask, channelTasks, justified, skipped };
  } catch (e) {
    // Rollback the whole chain — never a partial orchestration.
    if (inserted.length) {
      await sb.from("hivemind_tasks").delete()
        .in("id", inserted.map((t) => t.id)).eq("workspace_id", workspaceId);
    }
    await sb.from("work_orders").delete().eq("id", wo.id).eq("workspace_id", workspaceId);
    throw e;
  }
}
