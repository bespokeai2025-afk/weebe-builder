/**
 * Website Marketing Executor — executes approved Website Change Queue items
 * via the Marketing Action Engine.
 *
 * WEBEE has NO website deployment integration, so the ONLY execution path is
 * an honest handoff: an approved change becomes a deployment package in
 * "awaiting_website_deployment" carrying the full CURRENT/PROPOSED/WHY/DATA/
 * IMPACT/RISK/ROLLBACK structure. It is NEVER marked applied/live here — a
 * human deploys it and marks the package deployed, which triggers URL
 * Inspection verification (markPackageDeployed).
 *
 * autoExecutableActionTypes deliberately omitted: every website change
 * requires human approval.
 */
import {
  registerMarketingExecutor,
  type MarketingExecutor,
} from "@/lib/marketing/action-engine.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

export const WEBSITE_CHANGE_ACTION_TYPE = "website_change_apply" as const;

async function loadChange(workspaceId: string, changeId: string): Promise<any> {
  const { data, error } = await sb
    .from("website_change_queue")
    .select("*")
    .eq("id", changeId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Website change not found in this workspace");
  return data;
}

const websiteExecutor: MarketingExecutor = {
  platform: "website",
  // autoExecutableActionTypes intentionally omitted — nothing runs on autopilot.

  async execute(action) {
    const workspaceId = action.workspace_id;
    if (action.action_type !== WEBSITE_CHANGE_ACTION_TYPE) {
      return { confirmed: false, error: `Unknown website action type: ${action.action_type}` };
    }
    const target = (action.target ?? {}) as Record<string, any>;
    const changeId = String(target.change_id ?? "");
    if (!changeId) return { confirmed: false, error: "target.change_id missing" };
    const change = await loadChange(workspaceId, changeId);
    // Only the atomically claimed "executing" state may run.
    if (change.status !== "executing") {
      return { confirmed: false, error: `Change is ${change.status}; only a claimed (executing) change can run.` };
    }
    const route = String(change.page_url ?? "");
    if (!/^https?:\/\//.test(route) && !route.startsWith("/")) {
      return { confirmed: false, error: `Deployment package requires a page URL/path target, got "${route}".` };
    }

    const pkg = {
      pageMode: "existing_page",
      route,
      changeType: change.change_type,
      structure: {
        current: change.current_state,
        proposed: change.proposed_state,
        why: change.why,
        supportingData: change.supporting_data,
        expectedImpact: change.expected_impact,
        risk: change.risk,
        rollback: change.rollback_plan,
      },
    };
    const manualInstructions = [
      "MANUAL WEBSITE DEPLOYMENT (WEBEE cannot modify the website directly):",
      `1. Open the page "${route}" in your website editor.`,
      `2. CURRENT: ${change.current_state}`,
      `3. PROPOSED: ${change.proposed_state}`,
      `4. WHY: ${change.why}`,
      `5. RISK: ${change.risk}`,
      `6. ROLLBACK: ${change.rollback_plan}`,
      "7. Publish the site, then return to WEBEE and mark the package deployed with the live URL — WEBEE verifies with URL Inspection.",
    ].join("\n");

    const { data: pkgRow, error } = await sb
      .from("growthmind_seo_deployment_packages")
      .insert({
        workspace_id: workspaceId,
        campaign_id: null,
        status: "awaiting_website_deployment",
        target_website: "Client website (manual deployment)",
        page_mode: "existing_page",
        proposed_route: route,
        package: pkg,
        rollback_content: { note: change.rollback_plan },
        manual_instructions: manualInstructions,
        created_by_user_id: action.requested_by ?? null,
      })
      .select("id")
      .single();
    if (error) return { confirmed: false, error: error.message };

    const { error: queueErr, data: queueUpdated } = await sb.from("website_change_queue").update({
      status: "handled", status_changed_at: new Date().toISOString(),
      package_id: pkgRow.id, marketing_action_id: action.id,
      measurement: {
        baseline: { capturedAt: new Date().toISOString(), evidence: change.supporting_data ?? {} },
        note: "Compare against future Clarity syncs for the same page once the change is actually deployed.",
      },
      updated_at: new Date().toISOString(),
    }).eq("id", change.id).eq("status", "executing").select("id");
    if (queueErr || !queueUpdated?.length) {
      // Fail closed: never report success while the queue row is stranded in
      // "executing". Compensate by removing the just-created package.
      await sb.from("growthmind_seo_deployment_packages").delete()
        .eq("id", pkgRow.id).eq("workspace_id", workspaceId)
        .eq("status", "awaiting_website_deployment");
      return {
        confirmed: false,
        error: queueErr
          ? `Queue row could not be marked handled: ${queueErr.message}`
          : "Queue row was no longer in 'executing' state — package creation rolled back",
      };
    }

    return {
      confirmed: true,
      externalResourceId: pkgRow.id,
      apiResponse: { packageId: pkgRow.id, status: "awaiting_website_deployment", note: "Handoff package created — the change is NOT live until a human deploys it and marks the package deployed." },
    };
  },

  async verify(action) {
    const workspaceId = action.workspace_id;
    const externalId = action.external_resource_id ?? null;
    if (!externalId) return { verified: false, note: "No package id recorded" };
    const { data } = await sb.from("growthmind_seo_deployment_packages")
      .select("id, status").eq("id", externalId).eq("workspace_id", workspaceId).maybeSingle();
    if (!data) return { verified: false, note: "Deployment package row not found" };
    // What is verified here is PACKAGE DELIVERY only — never the live change.
    return {
      verified: true,
      observedState: { verifiedScope: "handoff_package_delivery", packageStatus: data.status },
      note: `Verified: handoff package delivered (status ${data.status}). The website change itself is NOT live and NOT verified — it becomes verified only after manual deployment + URL Inspection.`,
    };
  },

  buildRollback() {
    // Manual handoff — rollback instructions live inside the package itself.
    return null;
  },
};

registerMarketingExecutor(websiteExecutor);
