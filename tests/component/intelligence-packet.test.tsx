/**
 * Universal Mind Intelligence Packet — quality gate contract tests.
 *
 * Proves: shallow Mind task creation is rejected; explicit Human Tasks pass
 * (labelled, never executable); readiness states compute in pipeline order;
 * approvable states are exactly the Ready-for-* set; the approve/run gate
 * blocks non-approvable gated tasks while allowing pre-gate legacy rows;
 * workspace scoping of prepared rows is preserved.
 */
import { describe, it, expect } from "vitest";
import {
  validateUniversalMindIntelligencePacket,
  isApprovableReadiness,
  MIND_TASK_READINESS_STATES,
  READINESS_LABELS,
  isHumanTaskRow,
  type UniversalMindIntelligencePacket,
} from "@/lib/minds/intelligence-packet.shared";
import {
  buildIntelligencePacket,
  buildInvestigationPacket,
  prepareMindTaskInsert,
  assertTaskApprovable,
  MindTaskQualityGateError,
  evidenceItem,
  sanitizeIncomingPacket,
} from "@/lib/minds/intelligence-packet.server";

const WS = "11111111-1111-1111-1111-111111111111";

function fullPacket(overrides: Partial<UniversalMindIntelligencePacket> = {}): UniversalMindIntelligencePacket {
  return buildIntelligencePacket({
    mind: "growthmind",
    objective: "Analyse Google Ads performance and draft optimisation change requests.",
    intentSource: "chat_tool:create_gads_analysis_work_order",
    targets: [{ domain: "marketing", entity_type: "gads_campaign", entity_id: "c-1", entity_name: "Brand", resolved: true }],
    evidence: [evidenceItem("growthmind_gads_campaigns", "30 days of synced data present.")],
    diagnosis: "CTR declined 20% over the last 30 days while spend held steady.",
    planSteps: [{ title: "Run analysis engine" }],
    deliverables: ["Analysis report"],
    successCriteria: ["Report produced"],
    cost: { known: false, note: "No spend change." },
    approvalScope: { kind: "analysis", summary: "Approve & run read-only analysis.", sensitive: false },
    ...(overrides as any),
  });
}

describe("readiness state computation (pipeline order)", () => {
  it("null / shallow packet → insufficient_context", () => {
    expect(validateUniversalMindIntelligencePacket(null).readiness).toBe("insufficient_context");
    const r = validateUniversalMindIntelligencePacket({ ...fullPacket(), objective: "" });
    expect(r.readiness).toBe("insufficient_context");
    expect(r.approvable).toBe(false);
  });

  it("missing integration → integration_required", () => {
    const p = fullPacket();
    p.blockers = [{ kind: "integration_missing", detail: "Google Ads not connected" }];
    const r = validateUniversalMindIntelligencePacket(p);
    expect(r.readiness).toBe("integration_required");
    expect(r.approvable).toBe(false);
  });

  it("unresolved or absent targets → target_resolution_required", () => {
    const none = fullPacket(); none.targets = [];
    expect(validateUniversalMindIntelligencePacket(none).readiness).toBe("target_resolution_required");
    const unres = fullPacket();
    unres.targets = [{ domain: "marketing", entity_type: "gads_campaign", entity_id: null, entity_name: "??", resolved: false }];
    const r = validateUniversalMindIntelligencePacket(unres);
    expect(r.readiness).toBe("target_resolution_required");
    expect(r.missing.join(" ")).toContain("unresolved target");
  });

  it("no evidence → evidence_gathering; no diagnosis → investigation_required", () => {
    const noEv = fullPacket(); noEv.evidence = [];
    expect(validateUniversalMindIntelligencePacket(noEv).readiness).toBe("evidence_gathering");
    const noDiag = fullPacket(); noDiag.diagnosis = null;
    expect(validateUniversalMindIntelligencePacket(noDiag).readiness).toBe("investigation_required");
  });

  it("missing plan/deliverables/criteria/scope → proposal_incomplete (never approvable)", () => {
    const p = fullPacket(); p.plan_steps = []; p.deliverables = [];
    const r = validateUniversalMindIntelligencePacket(p);
    expect(r.readiness).toBe("proposal_incomplete");
    expect(r.approvable).toBe(false);
    expect(r.missing).toContain("plan_steps");
  });

  it("invented cost is rejected: cost.known=false with an amount → proposal_incomplete", () => {
    const p = fullPacket(); p.cost = { known: false, amount: 500 } as any;
    const r = validateUniversalMindIntelligencePacket(p);
    expect(r.readiness).toBe("proposal_incomplete");
    expect(r.missing.join(" ")).toContain("cost.amount");
  });

  it("complete packet → ready_for_{scope} and approvable", () => {
    expect(validateUniversalMindIntelligencePacket(fullPacket()).readiness).toBe("ready_for_analysis_approval");
    const scopes: Array<[any, string]> = [
      ["content", "ready_for_content_approval"],
      ["change", "ready_for_change_approval"],
      ["publication", "ready_for_publication_approval"],
      ["execution", "ready_for_execution"],
      ["review", "ready_for_review"],
    ];
    for (const [kind, expected] of scopes) {
      const p = fullPacket();
      p.approval_scope = { kind, summary: "scope", sensitive: false };
      const r = validateUniversalMindIntelligencePacket(p);
      expect(r.readiness).toBe(expected);
      expect(r.approvable).toBe(expected !== "ready_for_review");
    }
  });

  it("every readiness state has a label; only Ready-for-approval/execution states are approvable", () => {
    for (const s of MIND_TASK_READINESS_STATES) expect(READINESS_LABELS[s]).toBeTruthy();
    const approvable = MIND_TASK_READINESS_STATES.filter((s) => isApprovableReadiness(s));
    expect(approvable.sort()).toEqual([
      "ready_for_analysis_approval", "ready_for_change_approval", "ready_for_content_approval",
      "ready_for_execution", "ready_for_publication_approval",
    ].sort());
    expect(isApprovableReadiness("ready_for_review")).toBe(false);
    expect(isApprovableReadiness(null)).toBe(false);
  });
});

describe("prepareMindTaskInsert quality gate", () => {
  it("rejects shallow Mind output (title+description+priority, no packet)", () => {
    expect(() => prepareMindTaskInsert(
      { workspace_id: WS, title: "Optimize Google Ads Keywords", description: "Do it", priority: "high", source: "hivemind_tool" },
      null,
    )).toThrowError(MindTaskQualityGateError);
  });

  it("explicit Human Task passes, is labelled and can never be executable", () => {
    const row = prepareMindTaskInsert(
      { workspace_id: WS, title: "Call the accountant", source: "manual", action_kind: "growthmind.gads_campaign_analysis", execution_status: "awaiting_approval" },
      null,
      { humanTask: true },
    );
    expect(row.metadata.human_task).toBe(true);
    expect(row.metadata.task_class).toBe("human_task");
    expect(row.action_kind).toBeNull();
    expect(row.execution_status).toBeNull();
    expect(row.workspace_id).toBe(WS);
    expect(isHumanTaskRow(row)).toBe(true);
  });

  it("source=manual rows are auto-classified Human Task even without the flag", () => {
    const row = prepareMindTaskInsert({ workspace_id: WS, title: "Reminder", source: "manual" }, null);
    expect(row.metadata.human_task).toBe(true);
  });

  it("executable row with incomplete packet is REJECTED by default", () => {
    const incomplete = buildInvestigationPacket({
      mind: "growthmind", objective: "Optimize keywords across the account somehow",
      intentSource: "chat_tool:create_growthmind_task", missing: ["targets"],
    });
    expect(() => prepareMindTaskInsert(
      { workspace_id: WS, title: "t", task_category: "executable", action_kind: "growthmind.gads_campaign_analysis", source: "hivemind_tool" },
      incomplete,
    )).toThrowError(/never reach an approvable state/);
  });

  it("executable row with incomplete packet downgrades to investigation when requested", () => {
    const incomplete = buildInvestigationPacket({
      mind: "growthmind", objective: "Optimize keywords across the account somehow",
      intentSource: "chat_tool:create_growthmind_task", missing: ["targets"],
    });
    const row = prepareMindTaskInsert(
      { workspace_id: WS, title: "t", task_category: "executable", action_kind: "growthmind.gads_campaign_analysis", source: "hivemind_tool" },
      incomplete,
      { onIncomplete: "investigate" },
    );
    expect(row.task_category).toBe("informational");
    expect(row.action_kind).toBeNull();
    expect(row.execution_status).toBeNull();
    expect(isApprovableReadiness(row.readiness_state)).toBe(false);
    expect(row.metadata.downgraded_from_executable).toBe(true);
  });

  it("executable row with a complete packet passes with approvable readiness", () => {
    const row = prepareMindTaskInsert(
      { workspace_id: WS, title: "Run analysis", task_category: "executable", action_kind: "growthmind.gads_campaign_analysis", source: "work_order" },
      fullPacket(),
    );
    expect(row.readiness_state).toBe("ready_for_analysis_approval");
    expect(row.packet_version).toBe(1);
    expect(row.intelligence_packet.objective).toContain("Google Ads");
    expect(row.workspace_id).toBe(WS); // workspace scoping preserved
  });

  it("informational Mind row with evidence packet lands non-approvable but stored", () => {
    const p = buildIntelligencePacket({
      mind: "hivemind", objective: "12 leads idle for 14+ days — re-engage them.",
      intentSource: "platform_scan:idle_leads",
      targets: [{ domain: "sales", entity_type: "leads", entity_id: "aggregate", entity_name: "12 leads", resolved: true }],
      evidence: [evidenceItem("platform_scan:idle_leads", "12 active leads idle 14+ days", { count: 12 })],
    });
    const row = prepareMindTaskInsert({ workspace_id: WS, title: "Idle leads", source: "ai_scan" }, p);
    expect(row.task_category).toBe("informational");
    expect(isApprovableReadiness(row.readiness_state)).toBe(false);
    expect(row.intelligence_packet.evidence.length).toBe(1);
  });
});

describe("sanitizeIncomingPacket (untrusted payload packets)", () => {
  it("rejects malformed shapes — falls back to null so callers rebuild server-side", () => {
    expect(sanitizeIncomingPacket(null)).toBeNull();
    expect(sanitizeIncomingPacket("packet")).toBeNull();
    expect(sanitizeIncomingPacket([])).toBeNull();
    expect(sanitizeIncomingPacket({})).toBeNull(); // no version
    expect(sanitizeIncomingPacket({ version: 99, mind: "x", objective: "y", intent: { source: "s" } })).toBeNull();
    expect(sanitizeIncomingPacket({ version: 1, mind: "", objective: "y", intent: { source: "s" } })).toBeNull();
    expect(sanitizeIncomingPacket({ version: 1, mind: "hivemind", objective: "", intent: { source: "s" } })).toBeNull();
    expect(sanitizeIncomingPacket({ version: 1, mind: "hivemind", objective: "y" })).toBeNull(); // no intent
    expect(sanitizeIncomingPacket({ version: 1, mind: "hivemind", objective: "y", intent: { source: "s" }, targets: "not-an-array" })).toBeNull();
    expect(sanitizeIncomingPacket({ version: 1, mind: "hivemind", objective: "y", intent: { source: "s" }, evidence: [{ source: 1 }] })).toBeNull();
    // Honest cost rule: unknown cost with an invented amount is rejected.
    expect(sanitizeIncomingPacket({ version: 1, mind: "hivemind", objective: "y", intent: { source: "s" }, cost: { known: false, amount: 500 } })).toBeNull();
  });

  it("a malformed payload packet can never be persisted as-is via prepareMindTaskInsert", () => {
    const malformed = { version: 1, mind: "hivemind", objective: "y", intent: { source: "s" }, evidence: "fake" };
    const sanitized = sanitizeIncomingPacket(malformed);
    expect(sanitized).toBeNull();
    // Caller pattern: sanitize ?? server-rebuilt fallback — never the raw object.
    const fallback = buildIntelligencePacket({
      mind: "hivemind", objective: "Follow-up", intentSource: "hivemind_action:create_task",
      targets: [{ domain: "general", entity_type: "workspace", entity_id: null, entity_name: null, resolved: false, resolution_note: "none" }],
      evidence: [evidenceItem("hivemind_actions", "Created from approved action.")],
    });
    const row = prepareMindTaskInsert({ workspace_id: WS, title: "t", source: "action" }, sanitized ?? fallback);
    expect(row.intelligence_packet).not.toBe(malformed);
    expect(row.intelligence_packet.evidence).toEqual(fallback.evidence);
  });

  it("accepts a well-formed packet and re-normalises it through the shared builder", () => {
    const good = fullPacket();
    const out = sanitizeIncomingPacket(good as any);
    expect(out).not.toBeNull();
    expect(out!.objective).toBe(good.objective);
    expect(validateUniversalMindIntelligencePacket(out).readiness).toBe("ready_for_analysis_approval");
  });
});

describe("assertTaskApprovable (approve/run enforcement)", () => {
  it("allows pre-gate legacy rows (no packet, no readiness)", () => {
    expect(() => assertTaskApprovable({ readiness_state: null, intelligence_packet: null })).not.toThrow();
  });
  it("blocks gated tasks in non-approvable readiness", () => {
    expect(() => assertTaskApprovable({ readiness_state: "investigation_required", intelligence_packet: {} }))
      .toThrowError(/not approvable yet/);
    expect(() => assertTaskApprovable({ readiness_state: null, intelligence_packet: {} }))
      .toThrowError(MindTaskQualityGateError);
  });
  it("allows approvable readiness", () => {
    expect(() => assertTaskApprovable({ readiness_state: "ready_for_analysis_approval", intelligence_packet: {} }))
      .not.toThrow();
  });
});
