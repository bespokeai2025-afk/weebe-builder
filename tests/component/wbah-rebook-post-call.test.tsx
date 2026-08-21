import { describe, expect, it } from "vitest";
import { resolveWbahRebookEntityIds } from "@/lib/wbah/post-call/wbah-rebook-entity.shared";
import { buildWbahRebookOpportunityPayload, REBOOK_HSD_CONSULTATION_BOOKED } from "@/lib/wbah/post-call/wbah-rebook-opportunity-payload.shared";
import { formatWbahRetellCallData } from "@/lib/wbah/post-call/wbah-format-data.shared";
import { defaultRebookPostCallWorkflowConfig } from "@/lib/wbah/workflow/wbah-rebook-workflow.shared";
import { isWbahRebookPostCallWorkflow } from "@/lib/wbah/post-call/wbah-rebook-post-call.server";
import { wbahPipelineToAutomationDocument } from "@/lib/automation-engine/adapters/wbah-graph.adapter";
import { validateWorkflowDocument } from "@/lib/automation-engine/parser/parse-workflow";
import { ensureAutomationEngineBootstrapped } from "@/lib/automation-engine/bootstrap";

describe("resolveWbahRebookEntityIds", () => {
  it("uses opportunity_id when provided", () => {
    expect(
      resolveWbahRebookEntityIds({
        crm_type: "opportunity",
        opportunity_id: "opp-123",
        lead_id: "should-not-win",
      }),
    ).toMatchObject({ opportunityId: "opp-123", crmType: "opportunity" });
  });

  it("falls back to lead_id when crm_type is opportunity", () => {
    expect(
      resolveWbahRebookEntityIds({
        crm_type: "opportunity",
        lead_id: "legacy-opp-id",
      }),
    ).toMatchObject({ opportunityId: "legacy-opp-id" });
  });

  it("uses lead_id as opportunity when crm_type is absent (rebook campaign dials)", () => {
    expect(
      resolveWbahRebookEntityIds({
        lead_id: "fe732cf4-0838-f111-88b3-7ced8d460595",
      }),
    ).toMatchObject({ opportunityId: "fe732cf4-0838-f111-88b3-7ced8d460595" });
  });

  it("rejects plain lead cohort when crm_type is lead", () => {
    expect(resolveWbahRebookEntityIds({ crm_type: "lead", lead_id: "lead-only" })).toBeNull();
  });
});

describe("buildWbahRebookOpportunityPayload", () => {
  it("maps only Opportunity-safe text fields", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { first_name: "Jane", last_name: "Smith" },
      custom: {},
    });
    const patch = buildWbahRebookOpportunityPayload({
      formatted,
      dynVars: {
        first_name: "Jane",
        last_name: "Smith",
        user_mobile: "+441234567890",
      },
      custom: {
        call_outcome: "Rebooked",
        on_market: "181510000",
        structured_json_output: JSON.stringify({ on_market: "181510000" }),
      },
    });
    expect(patch.new_firstname).toBe("Jane");
    expect(patch.new_lastname).toBe("Smith");
    expect(patch.new_mobile).toBe("+441234567890");
    expect(patch).not.toHaveProperty("cos_onmarket");
    expect(patch).not.toHaveProperty("cos_statusreason1");
  });

  it("sets consultation datetime and cr_hsdconsultation=Booked when slot confirmed", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { first_name: "Caroline", last_name: "Moore" },
      custom: {
        calendly_slot: JSON.stringify({
          preferred_slot: { date: "2026-08-06", time: "16:50" },
        }),
        appointment_confirmed: true,
      },
    });
    expect(formatted.requestedStartUtc).toBeTruthy();

    const patch = buildWbahRebookOpportunityPayload({
      formatted,
      dynVars: { first_name: "Caroline", last_name: "Moore", user_mobile: "+447712461000" },
      custom: {},
    });

    expect(patch.crf6a_new_appointmentdatetime).toBe(formatted.requestedStartUtc);
    expect(patch.cr_dateofhsdconsultation).toBe(formatted.requestedStartUtc);
    expect(patch.cr_hsdconsultation).toBe(REBOOK_HSD_CONSULTATION_BOOKED);
  });

  it("skips consultation fields when no booking slot", () => {
    const formatted = formatWbahRetellCallData({
      dynVars: { first_name: "Caroline", last_name: "Moore" },
      custom: {},
    });
    const patch = buildWbahRebookOpportunityPayload({
      formatted,
      dynVars: { first_name: "Caroline", last_name: "Moore" },
      custom: {},
    });
    expect(patch).not.toHaveProperty("cr_hsdconsultation");
    expect(patch).not.toHaveProperty("crf6a_new_appointmentdatetime");
  });
});

describe("rebook workflow config", () => {
  it("excludes Calendly and Lead PATCH steps", () => {
    const cfg = defaultRebookPostCallWorkflowConfig();
    const enabled = cfg.steps.filter((s) => s.enabled).map((s) => s.id);
    expect(enabled).not.toContain("calendly_link");
    expect(enabled).not.toContain("dynamics_allens");
    expect(enabled).toContain("dynamics_rebook_opportunity");
    expect(cfg.n8n_graph?.nodes.length).toBeGreaterThan(10);
    expect(cfg.workflow_kind).toBe("wbah_rebook_post_call");
  });

  it("detects rebook by role or workflow_kind", () => {
    expect(isWbahRebookPostCallWorkflow(defaultRebookPostCallWorkflowConfig())).toBe(true);
    expect(isWbahRebookPostCallWorkflow(null, "rebooking")).toBe(true);
    expect(isWbahRebookPostCallWorkflow(null, "new_leads_dialer")).toBe(false);
  });

  it("rebook automation graph has reachable entry from rebook-webhook", () => {
    ensureAutomationEngineBootstrapped();
    const doc = wbahPipelineToAutomationDocument(defaultRebookPostCallWorkflowConfig());
    const validation = validateWorkflowDocument(doc);
    expect(validation.errors.some((e) => e.includes("unreachable"))).toBe(false);
    expect(doc.nodes.some((n) => n.id === "rebook-webhook" && n.type === "core.webhook")).toBe(true);
  });
});
