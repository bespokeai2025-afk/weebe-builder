/**
 * Channel intelligence packets — shared (client-safe) pure helpers.
 *
 * Task #488: sales/CRM, follow-up, WhatsApp, Email/HexMail and call-campaign
 * instructions must produce evidence-backed intelligence packets with split,
 * scoped approvals — never generic "Review the pipeline" tasks.
 *
 * Everything here is pure and deterministic (no DB, no secrets) so the
 * component test suite can exercise consent, suppression, duplicate-send and
 * audience-validation rules directly. The server module
 * (hivemind/channel-work-orders.server.ts) feeds these helpers with real rows.
 */

import type { ApprovalScopeKind } from "./intelligence-packet.shared";

// ── Channels ─────────────────────────────────────────────────────────────────
export type OutreachChannel = "whatsapp" | "email" | "call" | "sms";

// ── Audience compliance (consent / opt-out / suppression / dedup) ────────────
export interface AudienceLeadInput {
  id: string;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
  status?: string | null;
  pipeline_stage?: string | null;
  whatsapp_opt_in?: boolean | null;
  last_contacted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface AudienceExclusion {
  reason:
    | "no_phone"
    | "no_email"
    | "not_opted_in"
    | "do_not_call"
    | "suppressed"
    | "duplicate";
  count: number;
}

export interface AudienceComplianceResult {
  channel: OutreachChannel;
  eligible: AudienceLeadInput[];
  excluded: AudienceExclusion[];
  totalInput: number;
  summary: string;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9@+.]/g, "");

/**
 * Filter an audience for a channel. Hard rules (never bypassed):
 *  - WhatsApp: explicit whatsapp_opt_in === true AND a phone number.
 *  - Email: an email address AND not on the suppression list.
 *  - Call/SMS: a phone number AND status !== do_not_call.
 *  - All channels: do_not_call leads are excluded, duplicates (same
 *    phone/email key) are removed keeping the first occurrence.
 */
export function filterAudienceForChannel(
  leads: AudienceLeadInput[],
  channel: OutreachChannel,
  opts: { suppressedEmails?: Iterable<string> } = {},
): AudienceComplianceResult {
  const suppressed = new Set(Array.from(opts.suppressedEmails ?? [], (e) => norm(e)));
  const counts: Record<AudienceExclusion["reason"], number> = {
    no_phone: 0, no_email: 0, not_opted_in: 0, do_not_call: 0, suppressed: 0, duplicate: 0,
  };
  const seen = new Set<string>();
  const eligible: AudienceLeadInput[] = [];

  for (const lead of leads) {
    if ((lead.status ?? "") === "do_not_call") { counts.do_not_call++; continue; }
    if (channel === "email") {
      const email = norm(lead.email);
      if (!email) { counts.no_email++; continue; }
      if (suppressed.has(email)) { counts.suppressed++; continue; }
      if (seen.has(`e:${email}`)) { counts.duplicate++; continue; }
      seen.add(`e:${email}`);
      eligible.push(lead);
      continue;
    }
    // phone-based channels
    const phone = norm(lead.phone);
    if (!phone) { counts.no_phone++; continue; }
    if (channel === "whatsapp" && lead.whatsapp_opt_in !== true) {
      counts.not_opted_in++; continue;
    }
    if (seen.has(`p:${phone}`)) { counts.duplicate++; continue; }
    seen.add(`p:${phone}`);
    eligible.push(lead);
  }

  const excluded = (Object.keys(counts) as AudienceExclusion["reason"][])
    .filter((k) => counts[k] > 0)
    .map((k) => ({ reason: k, count: counts[k] }));

  const excludedTotal = excluded.reduce((s, e) => s + e.count, 0);
  return {
    channel,
    eligible,
    excluded,
    totalInput: leads.length,
    summary:
      `${eligible.length} of ${leads.length} lead(s) eligible for ${channel}` +
      (excludedTotal
        ? ` (${excluded.map((e) => `${e.count} ${e.reason.replace(/_/g, " ")}`).join(", ")} excluded)`
        : ""),
  };
}

// ── Split approval stages ────────────────────────────────────────────────────
export interface ApprovalStage {
  key: string;
  label: string;
  kind: ApprovalScopeKind;
  /** True for the final Send/Launch stage — blocked until prior approvals. */
  finalSend: boolean;
}

export type ChannelCampaignKind = "whatsapp" | "email" | "call" | "followup";

/**
 * Split approval ladder per channel (spec sections 5–7): approving copy never
 * authorises sending; the final Send/Launch stage is created BLOCKED and only
 * becomes actionable once every earlier stage is approved and provider checks
 * pass.
 */
export function approvalStagesForChannel(kind: ChannelCampaignKind): ApprovalStage[] {
  switch (kind) {
    case "whatsapp":
      return [
        { key: "audience", label: "Audience", kind: "change", finalSend: false },
        { key: "template", label: "Template", kind: "content", finalSend: false },
        { key: "schedule", label: "Schedule", kind: "change", finalSend: false },
        { key: "follow_up", label: "Follow-Up", kind: "change", finalSend: false },
        { key: "send", label: "Send", kind: "execution", finalSend: true },
      ];
    case "email":
      return [
        { key: "audience", label: "Audience", kind: "change", finalSend: false },
        { key: "copy", label: "Copy", kind: "content", finalSend: false },
        { key: "sequence", label: "Sequence", kind: "change", finalSend: false },
        { key: "schedule", label: "Schedule", kind: "change", finalSend: false },
        { key: "send", label: "Send", kind: "execution", finalSend: true },
      ];
    case "call":
      return [
        { key: "audience", label: "Audience", kind: "change", finalSend: false },
        { key: "agent_script", label: "Agent & Script", kind: "content", finalSend: false },
        { key: "schedule", label: "Schedule", kind: "change", finalSend: false },
        { key: "volume", label: "Volume", kind: "change", finalSend: false },
        { key: "launch", label: "Launch", kind: "execution", finalSend: true },
      ];
    case "followup":
      return [
        { key: "audience", label: "Audience", kind: "change", finalSend: false },
        { key: "sequence", label: "Sequence", kind: "change", finalSend: false },
        { key: "schedule", label: "Schedule", kind: "change", finalSend: false },
        { key: "send", label: "Send", kind: "execution", finalSend: true },
      ];
  }
}

// ── Follow-up sequences ──────────────────────────────────────────────────────
/** Stop conditions every proposed sequence must honour (spec section 6). */
export const SEQUENCE_STOP_CONDITIONS = [
  "Lead replies on any channel",
  "Lead opts out / unsubscribes",
  "Meeting or appointment booked",
  "Lead disqualified or marked Do Not Call",
  "Campaign paused",
  "Compliance block (consent withdrawn, suppression, quiet hours)",
] as const;

export interface SequenceStepPlan {
  day: number;
  channel: OutreachChannel;
  window: string; // e.g. "09:00–18:00 lead-local"
  description: string;
}

/**
 * Build a coordinated multi-channel sequence plan. Deterministic rules:
 * one touch per day maximum (no duplicate/overlapping sends), channels
 * rotate in the caller-provided priority order, and every step carries a
 * send window. Pure — no scheduling side effects.
 */
export function buildFollowUpSequencePlan(
  channels: OutreachChannel[],
  touches: number,
  opts: { startDay?: number; gapDays?: number; window?: string } = {},
): SequenceStepPlan[] {
  const uniqueChannels = Array.from(new Set(channels));
  if (!uniqueChannels.length || touches <= 0) return [];
  const gap = Math.max(1, Math.round(opts.gapDays ?? 2));
  const window = opts.window ?? "09:00–18:00 lead-local time";
  const steps: SequenceStepPlan[] = [];
  let day = Math.max(0, Math.round(opts.startDay ?? 0));
  for (let i = 0; i < touches; i++) {
    const channel = uniqueChannels[i % uniqueChannels.length];
    steps.push({
      day,
      channel,
      window,
      description:
        channel === "call" ? "AI agent call attempt (voicemail policy applies)"
        : channel === "whatsapp" ? "WhatsApp template message (approved template only)"
        : channel === "email" ? "Email step from the approved sequence copy"
        : "SMS follow-up message",
    });
    day += gap;
  }
  return steps;
}

/** True when a plan never sends two touches to the same lead on the same day. */
export function sequenceHasNoOverlappingSends(steps: SequenceStepPlan[]): boolean {
  const days = steps.map((s) => s.day);
  return new Set(days).size === days.length;
}

// ── Sales pipeline diagnosis ─────────────────────────────────────────────────
export interface PipelineLeadFacts {
  id: string;
  full_name?: string | null;
  pipeline_stage?: string | null;
  status?: string | null;
  phone?: string | null;
  email?: string | null;
  sale_amount?: number | null;
  call_outcome?: string | null;
  objections?: string | null;
  external_source_id?: string | null;
  source?: string | null;
  last_contacted_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface PipelineAnalysis {
  totalLeads: number;
  stageCounts: Record<string, number>;
  stalled: Array<{ id: string; name: string; stage: string; daysIdle: number }>;
  neverContacted: number;
  missingContactInfo: number;
  duplicatePhones: number;
  lostOrDoNotCall: number;
  wonCount: number;
  conversionPct: number | null;
  /** Deal value across leads that carry a sale_amount. */
  dealValue: { totalKnown: number; leadsWithValue: number; avgKnown: number | null; wonValue: number };
  /** Lost/disqualified leads with the recorded reason (call_outcome/objections) or "unrecorded". */
  lostReasons: Record<string, number>;
  lostWithoutReason: number;
  /** CRM sync state: rows carrying an external source id vs. local-only rows. */
  syncState: { externallySynced: number; localOnly: number };
  /** Per-field completeness gaps on critical CRM fields. */
  missingCriticalFields: { name: number; phone: number; email: number; stage: number };
  diagnosis: string;
}

const ACTIVE_STAGES = new Set(["lead", "qualified", "contact_made", "meeting_booked", "proposal", "negotiation"]);
const WON_STAGES = new Set(["sale_done", "won", "closed_won"]);

/**
 * Deterministic pipeline analysis over real lead rows (no AI, no invention).
 * `now` is injectable for tests.
 */
export function analysePipelineLeads(
  leads: PipelineLeadFacts[],
  opts: { now?: Date; stalledAfterDays?: number; maxStalledListed?: number } = {},
): PipelineAnalysis {
  const now = opts.now ?? new Date();
  const stalledAfter = opts.stalledAfterDays ?? 14;
  const maxListed = opts.maxStalledListed ?? 10;

  const stageCounts: Record<string, number> = {};
  const stalled: PipelineAnalysis["stalled"] = [];
  let neverContacted = 0;
  let missingContactInfo = 0;
  let lostOrDoNotCall = 0;
  let wonCount = 0;
  let dealTotal = 0;
  let dealLeads = 0;
  let wonValue = 0;
  let externallySynced = 0;
  let lostWithoutReason = 0;
  const lostReasons: Record<string, number> = {};
  const missingCriticalFields = { name: 0, phone: 0, email: 0, stage: 0 };
  const phoneSeen = new Map<string, number>();

  for (const lead of leads) {
    const stage = lead.pipeline_stage || lead.status || "unstaged";
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;

    const isLost = (lead.status ?? "") === "do_not_call" || /lost|disqualified/.test(stage);
    if (isLost) {
      lostOrDoNotCall++;
      const reason = (lead.call_outcome || lead.objections || "").trim();
      if (reason) lostReasons[reason] = (lostReasons[reason] ?? 0) + 1;
      else lostWithoutReason++;
    }
    if (WON_STAGES.has(stage)) {
      wonCount++;
      if (typeof lead.sale_amount === "number" && lead.sale_amount > 0) wonValue += lead.sale_amount;
    }
    if (typeof lead.sale_amount === "number" && lead.sale_amount > 0) {
      dealTotal += lead.sale_amount;
      dealLeads++;
    }
    if (lead.external_source_id) externallySynced++;
    if (!lead.full_name) missingCriticalFields.name++;
    if (!lead.phone) missingCriticalFields.phone++;
    if (!lead.email) missingCriticalFields.email++;
    if (!lead.pipeline_stage) missingCriticalFields.stage++;
    if (!lead.phone && !lead.email) missingContactInfo++;
    if (!lead.last_contacted_at) neverContacted++;

    const p = norm(lead.phone);
    if (p) phoneSeen.set(p, (phoneSeen.get(p) ?? 0) + 1);

    if (ACTIVE_STAGES.has(stage)) {
      const lastTouch = lead.last_contacted_at ?? lead.updated_at ?? lead.created_at;
      if (lastTouch) {
        const daysIdle = Math.floor((now.getTime() - Date.parse(lastTouch)) / 86_400_000);
        if (daysIdle >= stalledAfter) {
          stalled.push({ id: lead.id, name: lead.full_name || "Unnamed lead", stage, daysIdle });
        }
      }
    }
  }
  stalled.sort((a, b) => b.daysIdle - a.daysIdle);

  const duplicatePhones = Array.from(phoneSeen.values()).reduce((s, c) => s + Math.max(0, c - 1), 0);
  const conversionPct = leads.length ? Math.round((wonCount / leads.length) * 1000) / 10 : null;
  const dealValue: PipelineAnalysis["dealValue"] = {
    totalKnown: Math.round(dealTotal * 100) / 100,
    leadsWithValue: dealLeads,
    avgKnown: dealLeads ? Math.round((dealTotal / dealLeads) * 100) / 100 : null,
    wonValue: Math.round(wonValue * 100) / 100,
  };
  const syncState = { externallySynced, localOnly: leads.length - externallySynced };

  const parts: string[] = [];
  parts.push(`${leads.length} lead(s) across ${Object.keys(stageCounts).length} stage(s).`);
  if (stalled.length) parts.push(`${stalled.length} active lead(s) stalled ≥${stalledAfter} days without contact.`);
  if (neverContacted) parts.push(`${neverContacted} lead(s) have never been contacted.`);
  if (missingContactInfo) parts.push(`${missingContactInfo} lead(s) missing both phone and email.`);
  if (duplicatePhones) parts.push(`${duplicatePhones} duplicate phone number(s) inflating counts.`);
  if (conversionPct != null) parts.push(`Won conversion is ${conversionPct}% (${wonCount} won).`);
  if (dealLeads) {
    parts.push(`Known deal value ${dealValue.totalKnown} across ${dealLeads} lead(s) (avg ${dealValue.avgKnown}); won value ${dealValue.wonValue}.`);
  } else {
    parts.push("No deal values recorded on any lead (sale_amount empty).");
  }
  if (lostOrDoNotCall) {
    const topReasons = Object.entries(lostReasons).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([r, c]) => `${r} (${c})`).join(", ");
    parts.push(
      `${lostOrDoNotCall} lost/disqualified lead(s)` +
      (topReasons ? `; top recorded reasons: ${topReasons}` : "") +
      (lostWithoutReason ? `; ${lostWithoutReason} lost without a recorded reason` : "") + ".");
  }
  parts.push(`CRM sync: ${externallySynced} externally-synced row(s), ${syncState.localOnly} local-only.`);
  const fieldGaps = Object.entries(missingCriticalFields).filter(([, c]) => c > 0)
    .map(([f, c]) => `${c} missing ${f}`).join(", ");
  if (fieldGaps) parts.push(`Critical field gaps: ${fieldGaps}.`);
  if (!stalled.length && !neverContacted && !missingContactInfo && !duplicatePhones && !fieldGaps) {
    parts.push("No stalled, uncontacted, duplicate or incomplete records detected in this snapshot.");
  }

  return {
    totalLeads: leads.length,
    stageCounts,
    stalled: stalled.slice(0, maxListed),
    neverContacted,
    missingContactInfo,
    duplicatePhones,
    lostOrDoNotCall,
    wonCount,
    conversionPct,
    dealValue,
    lostReasons,
    lostWithoutReason,
    syncState,
    missingCriticalFields,
    diagnosis: parts.join(" "),
  };
}

/**
 * Record-tied proposed changes from a pipeline analysis: every change names a
 * real lead / real defect with owner, channel, schedule and risk baked into
 * the change text. Nothing here moves stages or contacts anyone — proposals
 * only.
 */
export function pipelineProposedChanges(
  analysis: PipelineAnalysis,
): Array<{ target: string; change: string; reversible: boolean }> {
  const changes: Array<{ target: string; change: string; reversible: boolean }> = [];
  for (const s of analysis.stalled.slice(0, 5)) {
    changes.push({
      target: `Lead "${s.name}" (${s.stage}, ${s.daysIdle}d idle)`,
      change:
        `Schedule a follow-up within 2 business days via the lead's preferred channel ` +
        `(owner: sales; risk: low — outreach requires the follow-up approvals; no automatic contact).`,
      reversible: true,
    });
  }
  if (analysis.duplicatePhones > 0) {
    changes.push({
      target: `${analysis.duplicatePhones} duplicate phone record(s)`,
      change: "Review and merge duplicates (owner: CRM admin; risk: low; merge is manual and auditable).",
      reversible: false,
    });
  }
  if (analysis.missingContactInfo > 0) {
    changes.push({
      target: `${analysis.missingContactInfo} lead(s) missing phone and email`,
      change: "Enrich or archive records with no reachable contact detail (owner: CRM admin; risk: low).",
      reversible: true,
    });
  }
  if (analysis.neverContacted > 0) {
    changes.push({
      target: `${analysis.neverContacted} never-contacted lead(s)`,
      change:
        "Propose a first-touch follow-up sequence (requires separate Audience/Schedule/Send approvals; " +
        "consent and opt-out rules enforced; owner: sales).",
      reversible: true,
    });
  }
  if (analysis.lostWithoutReason > 0) {
    changes.push({
      target: `${analysis.lostWithoutReason} lost/disqualified lead(s) with no recorded reason`,
      change:
        "Backfill lost reasons (call outcome/objection) so loss analysis is trustworthy " +
        "(owner: sales; risk: low; data entry only, no outreach).",
      reversible: true,
    });
  }
  if (analysis.totalLeads > 0 && analysis.dealValue.leadsWithValue === 0) {
    changes.push({
      target: "Deal values (sale_amount)",
      change:
        "No lead carries a deal value — record expected/actual amounts on active and won leads so " +
        "pipeline value and forecasts are real (owner: sales; risk: low).",
      reversible: true,
    });
  }
  const fieldGapTotal =
    analysis.missingCriticalFields.name + analysis.missingCriticalFields.stage;
  if (fieldGapTotal > 0) {
    changes.push({
      target: `${fieldGapTotal} record(s) with missing critical CRM fields (name/stage)`,
      change:
        "Complete missing names and pipeline stages so routing, dedup and reporting work " +
        "(owner: CRM admin; risk: low; no outreach).",
      reversible: true,
    });
  }
  return changes;
}

// ── Audience preference evidence (timezone / preferred channel) ─────────────
export interface AudiencePreferenceLead {
  id: string;
  state_name?: string | null;
  meta?: Record<string, unknown> | null;
}

export interface AudiencePreferenceSummary {
  timezones: Record<string, number>;
  unknownTimezone: number;
  preferredChannels: Record<string, number>;
  unknownPreferredChannel: number;
  summary: string;
}

/**
 * Summarise real per-lead timezone / preferred-channel signals for a segment.
 * Reads only what the rows actually carry (meta.timezone, meta.preferred_contact,
 * state_name as a locality hint) — leads with no signal are counted as unknown,
 * never guessed.
 */
export function summariseAudiencePreferences(
  leads: AudiencePreferenceLead[],
): AudiencePreferenceSummary {
  const timezones: Record<string, number> = {};
  const preferredChannels: Record<string, number> = {};
  let unknownTimezone = 0;
  let unknownPreferredChannel = 0;
  for (const lead of leads) {
    const meta = (lead.meta ?? {}) as Record<string, unknown>;
    const tz = String(meta.timezone ?? meta.time_zone ?? "").trim()
      || (lead.state_name ? `state:${lead.state_name}` : "");
    if (tz) timezones[tz] = (timezones[tz] ?? 0) + 1;
    else unknownTimezone++;
    const pref = String(meta.preferred_contact ?? meta.preferred_contact_method ?? "").trim().toLowerCase();
    if (pref) preferredChannels[pref] = (preferredChannels[pref] ?? 0) + 1;
    else unknownPreferredChannel++;
  }
  const fmt = (m: Record<string, number>) =>
    Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([k, c]) => `${k}: ${c}`).join(", ") || "none recorded";
  return {
    timezones,
    unknownTimezone,
    preferredChannels,
    unknownPreferredChannel,
    summary:
      `Timezone signals — ${fmt(timezones)}${unknownTimezone ? ` (${unknownTimezone} unknown)` : ""}. ` +
      `Preferred channel — ${fmt(preferredChannels)}${unknownPreferredChannel ? ` (${unknownPreferredChannel} unrecorded)` : ""}.`,
  };
}

// ── WhatsApp country distribution & cost estimate ────────────────────────────
const COUNTRY_PREFIXES: Array<[string, string]> = [
  ["+44", "United Kingdom"], ["+353", "Ireland"], ["+27", "South Africa"],
  ["+61", "Australia"], ["+64", "New Zealand"], ["+91", "India"],
  ["+971", "United Arab Emirates"], ["+49", "Germany"], ["+33", "France"],
  ["+34", "Spain"], ["+31", "Netherlands"], ["+1", "US/Canada"],
];

export interface CountryDistribution {
  byCountry: Record<string, number>;
  unknown: number;
  summary: string;
}

/**
 * Deterministic country distribution from E.164-ish phone prefixes. Numbers
 * without a recognised international prefix are counted as unknown (country
 * rules must then be confirmed at the Schedule approval — never assumed).
 */
export function summariseCountryDistribution(phones: Array<string | null | undefined>): CountryDistribution {
  const byCountry: Record<string, number> = {};
  let unknown = 0;
  for (const raw of phones) {
    const p = (raw ?? "").replace(/[^\d+]/g, "");
    const normalised = p.startsWith("00") ? `+${p.slice(2)}` : p;
    const hit = normalised.startsWith("+")
      ? COUNTRY_PREFIXES.find(([prefix]) => normalised.startsWith(prefix))
      : undefined;
    if (hit) byCountry[hit[1]] = (byCountry[hit[1]] ?? 0) + 1;
    else unknown++;
  }
  const listed = Object.entries(byCountry).sort((a, b) => b[1] - a[1])
    .map(([c, n]) => `${c}: ${n}`).join(", ");
  return {
    byCountry,
    unknown,
    summary:
      (listed || "No internationally-prefixed numbers") +
      (unknown ? `; ${unknown} number(s) without a recognised country prefix (country rules must be confirmed before send)` : ""),
  };
}

export interface WhatsAppCostEstimate {
  messages: number;
  perMessageLow: number;
  perMessageHigh: number;
  totalLow: number;
  totalHigh: number;
  note: string;
}

/**
 * Honest cost RANGE for a WhatsApp template campaign: volume is real (eligible
 * audience), the per-message rate is an explicit assumption range because
 * actual Meta/WATI conversation pricing varies by country and category.
 */
export function estimateWhatsAppCampaignCost(
  messages: number,
  opts: { perMessageLow?: number; perMessageHigh?: number; currency?: string } = {},
): WhatsAppCostEstimate {
  const low = opts.perMessageLow ?? 0.03;
  const high = opts.perMessageHigh ?? 0.09;
  const cur = opts.currency ?? "GBP";
  const totalLow = Math.round(messages * low * 100) / 100;
  const totalHigh = Math.round(messages * high * 100) / 100;
  return {
    messages,
    perMessageLow: low,
    perMessageHigh: high,
    totalLow,
    totalHigh,
    note:
      `${messages} message(s) × ${low}–${high} ${cur} assumed per template message → ` +
      `estimated ${totalLow}–${totalHigh} ${cur}. Actual Meta/WATI conversation pricing varies by destination country ` +
      `and template category; the real rate applies at send time.`,
  };
}
