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
  const phoneSeen = new Map<string, number>();

  for (const lead of leads) {
    const stage = lead.pipeline_stage || lead.status || "unstaged";
    stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;

    if ((lead.status ?? "") === "do_not_call" || /lost|disqualified/.test(stage)) lostOrDoNotCall++;
    if (WON_STAGES.has(stage)) wonCount++;
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

  const parts: string[] = [];
  parts.push(`${leads.length} lead(s) across ${Object.keys(stageCounts).length} stage(s).`);
  if (stalled.length) parts.push(`${stalled.length} active lead(s) stalled ≥${stalledAfter} days without contact.`);
  if (neverContacted) parts.push(`${neverContacted} lead(s) have never been contacted.`);
  if (missingContactInfo) parts.push(`${missingContactInfo} lead(s) missing both phone and email.`);
  if (duplicatePhones) parts.push(`${duplicatePhones} duplicate phone number(s) inflating counts.`);
  if (conversionPct != null) parts.push(`Won conversion is ${conversionPct}% (${wonCount} won).`);
  if (!stalled.length && !neverContacted && !missingContactInfo && !duplicatePhones) {
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
  return changes;
}
