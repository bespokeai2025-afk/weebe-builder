/**
 * Task #488 — channel intelligence packets: consent, suppression,
 * duplicate-send protection, audience validation, split approvals and
 * blocked Send readiness through the universal packet validator.
 */
import { describe, it, expect } from "vitest";
import {
  filterAudienceForChannel,
  approvalStagesForChannel,
  buildFollowUpSequencePlan,
  sequenceHasNoOverlappingSends,
  analysePipelineLeads,
  pipelineProposedChanges,
  SEQUENCE_STOP_CONDITIONS,
  type AudienceLeadInput,
} from "@/lib/minds/channel-packets.shared";
import {
  validateUniversalMindIntelligencePacket,
  APPROVABLE_READINESS_STATES,
  type UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";

const lead = (over: Partial<AudienceLeadInput> & { id: string }): AudienceLeadInput => ({
  full_name: "Test Lead",
  phone: "+447700900001",
  email: "lead@example.com",
  status: "need_to_call",
  pipeline_stage: "lead",
  whatsapp_opt_in: false,
  last_contacted_at: null,
  ...over,
});

describe("filterAudienceForChannel — consent & compliance", () => {
  it("whatsapp includes ONLY explicitly opted-in leads with a phone", () => {
    const r = filterAudienceForChannel([
      lead({ id: "a", whatsapp_opt_in: true }),
      lead({ id: "b", whatsapp_opt_in: false, phone: "+447700900002" }),
      lead({ id: "c", whatsapp_opt_in: null, phone: "+447700900003" }),
      lead({ id: "d", whatsapp_opt_in: true, phone: null }),
    ], "whatsapp");
    expect(r.eligible.map((l) => l.id)).toEqual(["a"]);
    expect(r.excluded.find((e) => e.reason === "not_opted_in")?.count).toBe(2);
    expect(r.excluded.find((e) => e.reason === "no_phone")?.count).toBe(1);
  });

  it("do_not_call leads are excluded on EVERY channel", () => {
    const leads = [lead({ id: "a", status: "do_not_call", whatsapp_opt_in: true })];
    for (const ch of ["whatsapp", "email", "call", "sms"] as const) {
      const r = filterAudienceForChannel(leads, ch);
      expect(r.eligible).toHaveLength(0);
      expect(r.excluded[0]).toEqual({ reason: "do_not_call", count: 1 });
    }
  });

  it("email enforces the suppression list (case/format-insensitive)", () => {
    const r = filterAudienceForChannel([
      lead({ id: "a", email: "Blocked@Example.com" }),
      lead({ id: "b", email: "ok@example.com" }),
      lead({ id: "c", email: null }),
    ], "email", { suppressedEmails: ["blocked@example.com"] });
    expect(r.eligible.map((l) => l.id)).toEqual(["b"]);
    expect(r.excluded.find((e) => e.reason === "suppressed")?.count).toBe(1);
    expect(r.excluded.find((e) => e.reason === "no_email")?.count).toBe(1);
  });

  it("duplicate-send protection: same phone/email counted once", () => {
    const call = filterAudienceForChannel([
      lead({ id: "a", phone: "+44 7700 900001" }),
      lead({ id: "b", phone: "+447700900001" }),
    ], "call");
    expect(call.eligible).toHaveLength(1);
    expect(call.excluded.find((e) => e.reason === "duplicate")?.count).toBe(1);

    const email = filterAudienceForChannel([
      lead({ id: "a", email: "x@example.com" }),
      lead({ id: "b", email: "X@EXAMPLE.COM" }),
    ], "email");
    expect(email.eligible).toHaveLength(1);
  });

  it("summary reports honest eligible/excluded numbers", () => {
    const r = filterAudienceForChannel(
      [lead({ id: "a", whatsapp_opt_in: true }), lead({ id: "b" })], "whatsapp");
    expect(r.summary).toContain("1 of 2");
    expect(r.totalInput).toBe(2);
  });
});

describe("approvalStagesForChannel — split approvals", () => {
  it("every channel ends with exactly one final Send/Launch execution stage", () => {
    for (const kind of ["whatsapp", "email", "call", "followup"] as const) {
      const stages = approvalStagesForChannel(kind);
      const finals = stages.filter((s) => s.finalSend);
      expect(finals).toHaveLength(1);
      expect(stages[stages.length - 1].finalSend).toBe(true);
      expect(finals[0].kind).toBe("execution");
      // Non-final stages are never execution-scoped — approving copy/audience
      // must never authorise sending.
      for (const s of stages.filter((x) => !x.finalSend)) {
        expect(s.kind).not.toBe("execution");
      }
    }
  });

  it("whatsapp has Audience/Template/Schedule/Send; email adds Copy+Sequence; call has Agent & Volume", () => {
    expect(approvalStagesForChannel("whatsapp").map((s) => s.key))
      .toEqual(["audience", "template", "schedule", "send"]);
    expect(approvalStagesForChannel("email").map((s) => s.key))
      .toEqual(["audience", "copy", "sequence", "schedule", "send"]);
    expect(approvalStagesForChannel("call").map((s) => s.key))
      .toEqual(["audience", "agent_script", "schedule", "volume", "launch"]);
  });
});

describe("buildFollowUpSequencePlan", () => {
  it("never schedules two touches on the same day (no duplicate sends)", () => {
    const plan = buildFollowUpSequencePlan(["call", "email", "whatsapp"], 6);
    expect(plan).toHaveLength(6);
    expect(sequenceHasNoOverlappingSends(plan)).toBe(true);
  });

  it("rotates channels and applies the gap", () => {
    const plan = buildFollowUpSequencePlan(["call", "email"], 4, { gapDays: 3 });
    expect(plan.map((s) => s.channel)).toEqual(["call", "email", "call", "email"]);
    expect(plan.map((s) => s.day)).toEqual([0, 3, 6, 9]);
  });

  it("returns empty for no channels or zero touches", () => {
    expect(buildFollowUpSequencePlan([], 3)).toEqual([]);
    expect(buildFollowUpSequencePlan(["email"], 0)).toEqual([]);
  });

  it("stop conditions cover reply, opt-out, booking, DNC and compliance", () => {
    const joined = SEQUENCE_STOP_CONDITIONS.join(" ").toLowerCase();
    for (const word of ["replies", "opts out", "booked", "do not call", "compliance"]) {
      expect(joined).toContain(word);
    }
  });
});

describe("analysePipelineLeads — deterministic evidence", () => {
  const now = new Date("2026-07-26T12:00:00Z");
  it("detects stalled, never-contacted, duplicates and missing contact info", () => {
    const a = analysePipelineLeads([
      lead({ id: "a", phone: "+447700900010", pipeline_stage: "qualified", last_contacted_at: "2026-06-01T00:00:00Z" }),
      lead({ id: "b", phone: "+447700900011", pipeline_stage: "lead", last_contacted_at: null, updated_at: "2026-07-25T00:00:00Z" }),
      lead({ id: "c", phone: "+447700900001", pipeline_stage: "proposal", last_contacted_at: "2026-07-25T00:00:00Z" }),
      lead({ id: "d", phone: "+44 7700 900001", pipeline_stage: "sale_done" }),
      lead({ id: "e", phone: null, email: null, pipeline_stage: "lead" }),
    ], { now, stalledAfterDays: 14 });
    expect(a.totalLeads).toBe(5);
    expect(a.stalled.map((s) => s.id)).toContain("a");
    expect(a.neverContacted).toBeGreaterThanOrEqual(2);
    expect(a.duplicatePhones).toBe(1);
    expect(a.missingContactInfo).toBe(1);
    expect(a.wonCount).toBe(1);
    expect(a.diagnosis.length).toBeGreaterThan(20);
  });

  it("proposed changes are record-tied (name real leads/defects)", () => {
    const a = analysePipelineLeads([
      lead({ id: "a", full_name: "Ada Lovelace", pipeline_stage: "qualified", last_contacted_at: "2026-05-01T00:00:00Z" }),
    ], { now });
    const changes = pipelineProposedChanges(a);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes[0].target).toContain("Ada Lovelace");
    expect(changes[0].change).toMatch(/owner:/i);
    expect(changes[0].change).toMatch(/risk:/i);
  });

  it("clean pipeline yields an honest 'no defects' diagnosis", () => {
    const a = analysePipelineLeads([
      lead({ id: "a", pipeline_stage: "lead", last_contacted_at: "2026-07-25T00:00:00Z" }),
    ], { now });
    expect(a.stalled).toHaveLength(0);
    expect(a.diagnosis).toContain("No stalled");
  });
});

describe("packet readiness through the universal validator", () => {
  const basePacket = (over: Partial<UniversalMindIntelligencePacket>): UniversalMindIntelligencePacket => ({
    version: 1,
    mind: "hivemind",
    objective: "Send a WhatsApp campaign to opted-in leads",
    intent: { source: "chat_tool:create_whatsapp_campaign_work_order", instruction: null },
    workspace_context: null,
    targets: [{ domain: "comms", entity_type: "whatsapp_campaign", entity_id: null, entity_name: "Campaign", resolved: true }],
    evidence: [{ source: "leads", description: "12 of 40 leads opted-in", data: null, retrieved_at: new Date().toISOString() }],
    diagnosis: "12 opted-in leads reachable; provider connected.",
    plan_steps: [{ order: 1, title: "Confirm audience" }],
    proposed_changes: [],
    deliverables: ["Audience approval"],
    success_criteria: ["No messages to non-opted-in numbers"],
    limitations: ["Proposal only"],
    cost: { known: false, note: "Provider pricing dependent" },
    approval_scope: { kind: "change", summary: "Approve Audience: 12 opted-in leads.", sensitive: false },
    monitoring: null,
    blockers: [],
    missing: [],
    created_at: new Date().toISOString(),
    ...over,
  });

  it("a complete non-final stage packet is approvable at its scoped state", () => {
    const v = validateUniversalMindIntelligencePacket(basePacket({}));
    expect(v.readiness).toBe("ready_for_change_approval");
    expect(v.approvable).toBe(true);
  });

  it("the final Send stage with an awaiting-prior-approvals blocker is BLOCKED, never approvable", () => {
    const v = validateUniversalMindIntelligencePacket(basePacket({
      approval_scope: { kind: "execution", summary: "Authorise sending.", sensitive: true },
      blockers: [{ kind: "other", detail: "Awaiting prior stage approvals (Audience, Template, Schedule)." }],
    }));
    expect(v.readiness).toBe("blocked");
    expect(v.approvable).toBe(false);
    expect(APPROVABLE_READINESS_STATES.has(v.readiness as any)).toBe(false);
  });

  it("missing provider integration yields integration_required (honest, not approvable)", () => {
    const v = validateUniversalMindIntelligencePacket(basePacket({
      blockers: [{ kind: "integration_missing", detail: "No WhatsApp provider connected (WATI)." }],
    }));
    expect(v.readiness).toBe("integration_required");
    expect(v.approvable).toBe(false);
  });

  it("unknown cost carrying an amount is rejected as incomplete (honest-cost rule)", () => {
    const v = validateUniversalMindIntelligencePacket(basePacket({
      cost: { known: false, amount: 42 },
    }));
    expect(v.approvable).toBe(false);
    expect(v.missing.join(" ")).toContain("cost.amount");
  });
});
