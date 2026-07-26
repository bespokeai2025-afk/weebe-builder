/**
 * Task #487 — intelligence packet UI contract.
 *
 * Covers:
 *  1. readinessControlFor: one readiness-appropriate control per state
 *     (fix vs approve), null for legacy pre-gate rows.
 *  2. scopedApprovalLabel: exact scoped labels incl. domain refinements
 *     (Approve Email Copy / Audience / Provider Changes / and Launch / and Send).
 *  3. taskApprovalMeta / actionApprovalMeta: dialog metadata honesty
 *     (effect, records, risk, reversibility, not-authorised, sensitive).
 *  4. IntelligencePacketPanel renders the human summary (objective, target,
 *     evidence, approval scope, freshness, blocker) with raw JSON only
 *     behind Developer details.
 *  5. ApprovalDialog renders the rich rows and exact confirm label.
 *  6. Source contract: manual status switching for Mind tasks is
 *     server-enforced in updateHiveMindTaskCore (human-task carve-out +
 *     informational acknowledge-only).
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { readFileSync } from "node:fs";
import {
  readinessControlFor, scopedApprovalLabel, readinessLabel,
  packetDataFreshness, packetMainBlocker, packetConfidence,
  taskApprovalMeta, actionApprovalMeta,
} from "@/lib/minds/intelligence-packet-ui.shared";
import type { UniversalMindIntelligencePacket } from "@/lib/minds/intelligence-packet.shared";
import { IntelligencePacketPanel, ApprovalDialog, ReadinessBadge } from "@/components/minds/IntelligencePacketPanel";

// ── Fixture packet ───────────────────────────────────────────────────────────
function fixturePacket(overrides: Partial<UniversalMindIntelligencePacket> = {}): UniversalMindIntelligencePacket {
  return {
    version: 1,
    mind: "growthmind",
    objective: "Analyse Google Ads performance and draft prioritised optimisation change requests.",
    intent: { source: "chat_tool:create_gads_analysis_work_order", raw_request: null },
    targets: [{
      domain: "marketing", entity_type: "gads_campaign", entity_id: "cmp-1",
      entity_name: "Search for US", resolved: true, resolution_note: null,
    }],
    evidence: [{
      source: "growthmind_gads_campaigns",
      description: "Synced Google Ads data available for the last 30 days.",
      retrieved_at: "2026-07-25T10:00:00.000Z",
      metrics: { lookback_days: 30 },
    }],
    diagnosis: "Campaign performance has not been analysed recently.",
    plan_steps: [
      { order: 1, title: "Refresh Google Ads data", detail: null, action_kind: "growthmind.gads_campaign_analysis" },
      { order: 2, title: "Run performance analysis", detail: null, action_kind: null },
    ],
    proposed_changes: [{
      target: 'Google Ads campaign "Search for US"',
      change: "Draft internal change requests only — no live Google Ads changes are made.",
      reversible: true,
    }],
    deliverables: ["Analysis report", "Prioritised change-request drafts (approval required)"],
    success_criteria: ["Analysis completes with a report"],
    limitations: ["GrowthMind is advisory-only: applying changes requires separate approval."],
    cost: { known: false, amount: null, currency: null, basis: null, note: "Internal analysis — no ad spend is changed." },
    approval_scope: {
      kind: "analysis",
      summary: "Approve & run a read-only Google Ads analysis (last 30 days). Makes no live changes.",
      sensitive: false,
    },
    monitoring: { metrics: ["recommendations_generated"], reassess_after_days: 14 },
    blockers: [],
    missing: [],
    workspace_context: { confidence: 0.82 },
    created_at: "2026-07-25T10:00:00.000Z",
    ...overrides,
  } as UniversalMindIntelligencePacket;
}

// ── 1. readinessControlFor ───────────────────────────────────────────────────
describe("readinessControlFor", () => {
  it("returns null for legacy pre-gate rows (no readiness, no packet)", () => {
    expect(readinessControlFor({ readiness_state: null, intelligence_packet: null })).toBeNull();
    expect(readinessControlFor({})).toBeNull();
  });

  it("returns a fix control (never Approve) for every non-approvable state", () => {
    const fixStates = [
      "insufficient_context", "target_resolution_required", "integration_required",
      "evidence_gathering", "investigation_required", "proposal_incomplete", "blocked",
    ];
    for (const s of fixStates) {
      const c = readinessControlFor({ readiness_state: s, intelligence_packet: fixturePacket() });
      expect(c?.kind, s).toBe("fix");
      expect(c?.label.toLowerCase(), s).not.toContain("approve");
      expect(c?.explanation.length, s).toBeGreaterThan(10);
    }
  });

  it("maps each fix state to its specific action label", () => {
    const expectLabel = (state: string, label: string) =>
      expect(readinessControlFor({ readiness_state: state, intelligence_packet: null })?.label).toBe(label);
    expectLabel("insufficient_context", "Supply Missing Details");
    expectLabel("target_resolution_required", "Select Target");
    expectLabel("integration_required", "Connect Provider");
    expectLabel("evidence_gathering", "Refresh Data");
    expectLabel("investigation_required", "Run Investigation");
    expectLabel("proposal_incomplete", "Generate Draft");
    expectLabel("blocked", "View Blocker");
  });

  it("maps ready_for_review to an info Review Deliverable control (never Approve, never a fix fallback)", () => {
    const c = readinessControlFor({ readiness_state: "ready_for_review", intelligence_packet: fixturePacket() });
    expect(c?.kind).toBe("info");
    expect(c?.label).toBe("Review Deliverable");
    expect(c?.label.toLowerCase()).not.toContain("approve");
  });

  it("returns an approve control with the scoped label for approvable states", () => {
    const c = readinessControlFor({
      readiness_state: "ready_for_analysis_approval",
      intelligence_packet: fixturePacket(),
    });
    expect(c?.kind).toBe("approve");
    expect(c?.label).toBe("Approve Analysis");
    // Explanation is the packet's approval-scope summary.
    expect(c?.explanation).toContain("read-only Google Ads analysis");
  });
});

// ── 2. scopedApprovalLabel ───────────────────────────────────────────────────
describe("scopedApprovalLabel", () => {
  const withTarget = (entity_type: string, domain = "marketing") =>
    fixturePacket({ targets: [{ domain: domain as any, entity_type, entity_id: null, entity_name: null, resolved: true, resolution_note: null }] });

  it("uses base labels per approvable readiness state", () => {
    expect(scopedApprovalLabel("ready_for_review", null)).toBe("Review Deliverable");
    expect(scopedApprovalLabel("ready_for_analysis_approval", null)).toBe("Approve Analysis");
    expect(scopedApprovalLabel("ready_for_content_approval", null)).toBe("Approve Content");
    expect(scopedApprovalLabel("ready_for_change_approval", null)).toBe("Approve Changes");
    expect(scopedApprovalLabel("ready_for_publication_approval", null)).toBe("Approve Publication");
    expect(scopedApprovalLabel("ready_for_execution", null)).toBe("Approve & Execute");
    expect(scopedApprovalLabel(null, null)).toBe("Approve");
  });

  it("refines content approvals by entity", () => {
    expect(scopedApprovalLabel("ready_for_content_approval", withTarget("hexmail_email"))).toBe("Approve Email Copy");
    expect(scopedApprovalLabel("ready_for_content_approval", withTarget("whatsapp_broadcast"))).toBe("Approve Message Copy");
    expect(scopedApprovalLabel("ready_for_content_approval", withTarget("call_script", "voice"))).toBe("Approve Call Script");
  });

  it("refines change approvals by entity/domain", () => {
    expect(scopedApprovalLabel("ready_for_change_approval", withTarget("lead_segment"))).toBe("Approve Audience");
    expect(scopedApprovalLabel("ready_for_change_approval", withTarget("gads_campaign"))).toBe("Approve Provider Changes");
    expect(scopedApprovalLabel("ready_for_change_approval", withTarget("integration", "systems"))).toBe("Approve Provider Changes");
  });

  it("refines execution approvals (launch/send)", () => {
    expect(scopedApprovalLabel("ready_for_execution", withTarget("campaign"))).toBe("Approve and Launch");
    expect(scopedApprovalLabel("ready_for_execution", withTarget("email_broadcast"))).toBe("Approve and Send");
  });
});

// ── 3. Packet summary helpers ────────────────────────────────────────────────
describe("packet summary helpers", () => {
  it("derives freshness from the newest evidence timestamp", () => {
    const packet = fixturePacket({
      evidence: [
        { source: "a", description: "old", retrieved_at: "2026-07-01T00:00:00.000Z", metrics: null },
        { source: "b", description: "new", retrieved_at: "2026-07-25T12:00:00.000Z", metrics: null },
      ],
    });
    expect(packetDataFreshness(packet)).toBe("2026-07-25T12:00:00.000Z");
    expect(packetDataFreshness(fixturePacket({ evidence: [] }))).toBeNull();
  });

  it("surfaces the main blocker (blockers first, then missing)", () => {
    expect(packetMainBlocker(fixturePacket())).toBeNull();
    expect(packetMainBlocker(fixturePacket({
      blockers: [{ kind: "integration", detail: "Google Ads is not connected.", fix_hint: null }] as any,
      missing: ["audience"],
    }))).toBe("Google Ads is not connected.");
    expect(packetMainBlocker(fixturePacket({ missing: ["audience definition"] }))).toBe("audience definition");
  });

  it("normalises confidence from workspace_context", () => {
    expect(packetConfidence(fixturePacket())).toBe(82);
    expect(packetConfidence(fixturePacket({ workspace_context: { confidence: 74 } }))).toBe(74);
    expect(packetConfidence(fixturePacket({ workspace_context: {} }))).toBeNull();
  });

  it("labels every readiness state and falls back for unknown", () => {
    expect(readinessLabel("ready_for_analysis_approval")).toBe("Ready for Analysis Approval");
    expect(readinessLabel("nonsense")).toBe("Pre-gate (legacy)");
  });
});

// ── 4. Approval dialog metadata ──────────────────────────────────────────────
describe("taskApprovalMeta", () => {
  it("builds honest dialog metadata from the packet", () => {
    const meta = taskApprovalMeta({
      title: "Run Google Ads campaign analysis",
      readiness_state: "ready_for_analysis_approval",
      intelligence_packet: fixturePacket(),
    });
    expect(meta.approveLabel).toBe("Approve Analysis");
    expect(meta.effect).toContain("read-only Google Ads analysis");
    expect(meta.recordsAffected).toContain('gads_campaign "Search for US"');
    expect(meta.reversible).toBe(true);
    expect(meta.risk).toContain("advisory-only");
    expect(meta.notAuthorised).toContain("No spend changes");
    expect(meta.sensitive).toBe(false);
    expect(meta.version).toBe("packet v1");
  });

  it("degrades gracefully without a packet (legacy row)", () => {
    const meta = taskApprovalMeta({ title: "Legacy task", readiness_state: null, intelligence_packet: null });
    expect(meta.approveLabel).toBe("Approve");
    expect(meta.effect).toContain("Legacy task");
    expect(meta.recordsAffected).toBe("No specific records targeted.");
    expect(meta.version).toBeNull();
  });

  it("marks sensitive scope as sensitive", () => {
    const meta = taskApprovalMeta({
      readiness_state: "ready_for_execution",
      intelligence_packet: fixturePacket({
        approval_scope: { kind: "execution", summary: "Send the broadcast.", sensitive: true },
      }),
    });
    expect(meta.sensitive).toBe(true);
  });
});

describe("actionApprovalMeta", () => {
  it("gives every consequential action type a scoped (non-generic) label", () => {
    const types = [
      ["create_followup_campaign", "Approve Campaign Draft"],
      ["enroll_leads_in_campaign", "Approve Audience"],
      ["launch_broadcast", "Approve and Send"],
      ["gads_create_change_requests", "Approve Provider Changes"],
      ["activate_lead_intake_workflow", "Approve and Launch"],
      ["growthmind_publish_content", "Approve Publication"],
      ["content_publication_approval", "Approve Publication"],
    ] as const;
    for (const [t, label] of types) {
      expect(actionApprovalMeta({ action_type: t }).approveLabel, t).toBe(label);
    }
  });

  it("summarises affected records from the payload without raw UUID walls", () => {
    const meta = actionApprovalMeta({
      action_type: "enroll_leads_in_campaign",
      action_payload: { lead_ids: ["a", "b", "c"], campaign_id: "cmp-9" },
    });
    expect(meta.recordsAffected).toBe("3 leads, 1 campaign");
    expect(meta.recordsAffected).not.toContain("cmp-9");
  });

  it("flags irreversible sends and states what is NOT authorised", () => {
    const meta = actionApprovalMeta({ action_type: "launch_broadcast" });
    expect(meta.reversible).toBe(false);
    expect(meta.notAuthorised).toContain("No additional sends");
  });

  it("respects row-level sensitive flag and embedded packets", () => {
    const meta = actionApprovalMeta({
      action_type: "create_task",
      sensitive: true,
      action_payload: { intelligence_packet: fixturePacket() },
    });
    expect(meta.sensitive).toBe(true);
    expect(meta.version).toBe("packet v1");
    expect(meta.currentState).toContain("not been analysed recently");
  });

  it("falls back honestly for unknown action types", () => {
    const meta = actionApprovalMeta({ action_type: "future_unknown_type", title: "New thing" });
    expect(meta.approveLabel).toBe("Approve Action");
    expect(meta.risk).toContain("Review the payload");
  });
});

// ── 5. IntelligencePacketPanel rendering ─────────────────────────────────────
describe("IntelligencePacketPanel", () => {
  it("renders the human summary with objective, target, evidence, scope and freshness", () => {
    render(<IntelligencePacketPanel packet={fixturePacket()} readinessState="ready_for_analysis_approval" />);
    expect(screen.getByText(/Analyse Google Ads performance and draft/)).toBeTruthy();
    expect(screen.getByText(/Search for US/)).toBeTruthy();
    expect(screen.getByText(/1 evidence source/)).toBeTruthy();
    expect(screen.getByText(/Approve & run a read-only Google Ads analysis/)).toBeTruthy();
    expect(screen.getByText("Ready for Analysis Approval")).toBeTruthy();
    expect(screen.getByText(/Confidence 82%/)).toBeTruthy();
    expect(screen.getByText(/Data as of/)).toBeTruthy();
  });

  it("keeps raw JSON hidden until Developer details is opened", () => {
    render(<IntelligencePacketPanel packet={fixturePacket()} readinessState="ready_for_analysis_approval" />);
    expect(screen.queryByText(/"entity_id"/)).toBeNull();
    fireEvent.click(screen.getByText("Show full packet"));
    expect(screen.getByText("Diagnosis")).toBeTruthy();
    expect(screen.getByText("Execution plan")).toBeTruthy();
    expect(screen.queryByText(/"entity_id"/)).toBeNull(); // still hidden
    fireEvent.click(screen.getByText("Developer details"));
    expect(screen.getByText(/"entity_id"/)).toBeTruthy();
  });

  it("shows the main blocker line when present", () => {
    render(<IntelligencePacketPanel
      packet={fixturePacket({ blockers: [{ kind: "integration", detail: "Google Ads is not connected.", fix_hint: null }] as any })}
      readinessState="integration_required"
    />);
    expect(screen.getByText(/Google Ads is not connected./)).toBeTruthy();
    expect(screen.getByText("Integration Required")).toBeTruthy();
  });

  it("renders nothing without a packet", () => {
    const { container } = render(<IntelligencePacketPanel packet={null} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("ReadinessBadge", () => {
  it("renders nothing for null state and the label otherwise", () => {
    const { container } = render(<ReadinessBadge state={null} />);
    expect(container.innerHTML).toBe("");
    render(<ReadinessBadge state="blocked" />);
    expect(screen.getByText("Blocked")).toBeTruthy();
  });
});

// ── 6. ApprovalDialog rendering ──────────────────────────────────────────────
describe("ApprovalDialog", () => {
  it("renders the rich rows and confirms with the exact scoped label", () => {
    const meta = taskApprovalMeta({
      title: "Run Google Ads campaign analysis",
      readiness_state: "ready_for_analysis_approval",
      intelligence_packet: fixturePacket(),
    });
    let confirmed = 0; let cancelled = 0;
    render(<ApprovalDialog
      meta={meta}
      packet={fixturePacket()}
      readinessState="ready_for_analysis_approval"
      onConfirm={() => { confirmed++; }}
      onCancel={() => { cancelled++; }}
    />);
    expect(screen.getByText("What happens")).toBeTruthy();
    expect(screen.getByText("Records affected")).toBeTruthy();
    expect(screen.getByText("Risk")).toBeTruthy();
    expect(screen.getByText("What happens next")).toBeTruthy();
    expect(screen.getByText("Not authorised by this approval")).toBeTruthy();
    const approveButtons = screen.getAllByText("Approve Analysis");
    // Header title + confirm button both carry the exact scoped label.
    expect(approveButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(approveButtons[approveButtons.length - 1]);
    expect(confirmed).toBe(1);
    fireEvent.click(screen.getByText("Cancel"));
    expect(cancelled).toBe(1);
  });

  it("shows the sensitive warning for sensitive approvals", () => {
    const meta = actionApprovalMeta({ action_type: "launch_broadcast", sensitive: true });
    render(<ApprovalDialog meta={meta} onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText(/never auto-executed/)).toBeTruthy();
    expect(screen.getByText(/Not reversible/)).toBeTruthy();
  });
});

// ── 7. Source contracts (server enforcement + UI gating stay wired) ─────────
describe("source contracts", () => {
  const tasksLib = readFileSync("src/lib/hivemind/hivemind.tasks.ts", "utf8");
  const tasksPage = readFileSync("src/routes/_authenticated/hivemind.tasks.tsx", "utf8");
  const actionsPage = readFileSync("src/routes/_authenticated/hivemind.actions.tsx", "utf8");

  it("updateHiveMindTaskCore enforces Mind-task status rules server-side", () => {
    // Human-task carve-out is checked via the shared helper…
    expect(tasksLib).toContain("isHumanTaskRow(row)");
    // …executable tasks stay fully blocked…
    expect(tasksLib).toContain("approve & run it instead of changing status manually");
    // …and other Mind tasks accept only the completed acknowledgement.
    expect(tasksLib).toMatch(/updates\.status !== "completed"/);
  });

  it("Tasks page routes approvals through the readiness control + dialog", () => {
    expect(tasksPage).toContain("readinessControlFor");
    expect(tasksPage).toContain("taskApprovalMeta");
    expect(tasksPage).toContain("<ApprovalDialog");
    // Manual status selector is Human-Task-only.
    expect(tasksPage).toMatch(/\{isHuman && \(\s*\n?\s*<div>\s*\n?\s*<label[^>]*>Status<\/label>/);
    // Non-human, non-executable tasks get Acknowledge only when no
    // readiness control applies (one readiness-appropriate control per card).
    expect(tasksPage).toContain("canAcknowledge");
    expect(tasksPage).toMatch(/canAcknowledge = [^;]*!showFixControl/);
    // Fix/review controls are not restricted to executable tasks.
    expect(tasksPage).toMatch(/showFixControl = \(control\?\.kind === "fix" \|\| control\?\.kind === "info"\)/);
  });

  it("Action Centre uses scoped labels and the rich dialog", () => {
    expect(actionsPage).toContain("actionApprovalMeta");
    expect(actionsPage).toContain("<ApprovalDialog");
    expect(actionsPage).toContain("approvalMeta.approveLabel");
  });
});
