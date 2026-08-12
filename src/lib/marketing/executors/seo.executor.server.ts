/**
 * SEO Marketing Executor — executes approved SEO Opportunity Queue items via
 * the Marketing Action Engine.
 *
 * Execution paths (all approval-first; autoExecutableActionTypes deliberately
 * omitted so NOTHING runs on autopilot):
 *  - seo_create_article / seo_refresh_content / seo_faq_section →
 *    creates an approval-first SEO blog campaign (existing pipeline: strategy →
 *    brief → article → safety gate → deployment package). "Confirmed" means
 *    the campaign was created — NOT that content is live.
 *  - seo_metadata_change / seo_page_change / seo_internal_links →
 *    creates a website deployment package in "awaiting_website_deployment".
 *    WEBEE cannot modify the website directly; the honest terminal state until
 *    a human deploys is Awaiting Website Deployment.
 *  - seo_sitemap_submit → real Search Console sitemap PUT, verified by
 *    reading the property's sitemap list back.
 *
 * Every execution links back to its growthmind_seo_opportunities row and
 * stamps measurement fields for later before/after comparison.
 */
import {
  registerMarketingExecutor,
  type MarketingExecutor,
} from "@/lib/marketing/action-engine.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

export const SEO_ACTION_TYPES = [
  "seo_create_article",
  "seo_refresh_content",
  "seo_faq_section",
  "seo_metadata_change",
  "seo_page_change",
  "seo_internal_links",
  "seo_sitemap_submit",
] as const;
export type SeoActionType = (typeof SEO_ACTION_TYPES)[number];

// Query-keyed opportunities route through the approval-first campaign pipeline
// (its analysis stage resolves the target page — a raw search query is not an
// actionable website route). Only URL-keyed changes become handoff packages.
export const CAMPAIGN_TYPES: Partial<Record<SeoActionType, string>> = {
  seo_create_article: "blog",
  seo_refresh_content: "content_refresh",
  seo_faq_section: "existing_page_improvement", // FAQ = add a section to an existing page; "faq" is not in the campaign_type DB constraint
  seo_metadata_change: "metadata",
  seo_internal_links: "internal_link",
};
const PACKAGE_TYPES = new Set<string>(["seo_page_change"]);

export function executionToActionType(execution: string): SeoActionType {
  switch (execution) {
    case "create_article": return "seo_create_article";
    case "refresh_content": return "seo_refresh_content";
    case "faq_section": return "seo_faq_section";
    case "metadata_change": return "seo_metadata_change";
    case "page_change": return "seo_page_change";
    case "internal_links": return "seo_internal_links";
    case "sitemap_submit": return "seo_sitemap_submit";
    default: throw new Error(`Unknown SEO execution path: ${execution}`);
  }
}

async function loadOpportunity(workspaceId: string, opportunityId: string): Promise<any> {
  const { data, error } = await sb
    .from("growthmind_seo_opportunities")
    .select("*")
    .eq("id", opportunityId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Opportunity not found in this workspace");
  return data;
}

async function stampOpportunity(opportunityId: string, patch: Record<string, any>): Promise<void> {
  await sb.from("growthmind_seo_opportunities")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", opportunityId);
}

/** Baseline metrics captured at execution time for honest before/after measurement. */
function baselineMeasurement(opportunity: any): Record<string, any> {
  return {
    baseline: {
      capturedAt: new Date().toISOString(),
      evidence: opportunity.evidence ?? {},
    },
    note: "Compare against future GSC syncs for the same query/page — GSC data finalises ~2-3 days late and ranking changes take weeks.",
  };
}

const seoExecutor: MarketingExecutor = {
  platform: "seo",
  // autoExecutableActionTypes intentionally omitted: every SEO action requires human approval.

  async execute(action) {
    const workspaceId = action.workspace_id;
    const actionType = action.action_type as SeoActionType;
    const target = (action.target ?? {}) as Record<string, any>;
    const opportunityId = String(target.opportunity_id ?? "");
    if (!opportunityId) return { confirmed: false, error: "target.opportunity_id missing" };
    const opportunity = await loadOpportunity(workspaceId, opportunityId);
    // Only the atomically claimed "executing" state may run — prevents a
    // double-submit from executing the same opportunity twice.
    if (opportunity.status !== "executing") {
      return { confirmed: false, error: `Opportunity is ${opportunity.status}; only a claimed (executing) opportunity can run.` };
    }

    // ── Campaign path ──
    const campaignType = CAMPAIGN_TYPES[actionType];
    if (campaignType) {
      const { createSeoCampaignCore } = await import("@/lib/growthmind/seo-blog-campaign.server");
      const res = await createSeoCampaignCore({
        workspaceId,
        userId: action.requested_by ?? null,
        name: opportunity.title,
        campaignType,
        primaryTopic: String(target.dim_key ?? opportunity.dim_key),
        objective: `SEO Opportunity Queue: ${opportunity.rationale}`,
      });
      if (!res?.ok || !res.campaignId) return { confirmed: false, error: res?.error ?? "Campaign creation failed" };
      await stampOpportunity(opportunityId, {
        status: "handled", status_changed_at: new Date().toISOString(),
        linked_campaign_id: res.campaignId, marketing_action_id: action.id,
        measurement: baselineMeasurement(opportunity),
      });
      return {
        confirmed: true,
        externalResourceId: res.campaignId,
        apiResponse: { campaignId: res.campaignId, note: "Approval-first SEO campaign created — content is NOT live; it follows the strategy/brief/content/deployment approval stages." },
      };
    }

    // ── Deployment-package path (website changes WEBEE cannot make itself) ──
    if (PACKAGE_TYPES.has(actionType)) {
      const route = String(target.dim_key ?? opportunity.dim_key ?? "");
      // A package must point at a concrete page — never a search query.
      if (!/^https?:\/\//.test(route) && !route.startsWith("/")) {
        return { confirmed: false, error: `Deployment package requires a page URL/path target, got "${route}".` };
      }
      const changeKind = actionType.replace(/^seo_/, "");
      const pkg = {
        pageMode: "existing_page",
        route,
        changeKind,
        opportunity: { kind: opportunity.kind, rationale: opportunity.rationale, evidence: opportunity.evidence },
        proposedChange: action.proposed_value ?? null,
        sitemapNote: "After deploying, resubmit the sitemap so Google recrawls the page.",
      };
      const manualInstructions = [
        "MANUAL WEBSITE DEPLOYMENT (WEBEE cannot modify the website directly):",
        `1. Open the page "${route}" in your website editor.`,
        `2. Apply the ${changeKind.replace(/_/g, " ")} described in the package (see proposedChange/opportunity evidence).`,
        "3. Publish the site.",
        "4. Return to WEBEE and mark the package as deployed with the live URL — WEBEE verifies with URL Inspection.",
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
          rollback_content: { note: "Capture the current live page state BEFORE applying the change to enable rollback." },
          manual_instructions: manualInstructions,
          created_by_user_id: action.requested_by ?? null,
        })
        .select("id")
        .single();
      if (error) return { confirmed: false, error: error.message };
      await stampOpportunity(opportunityId, {
        status: "handled", status_changed_at: new Date().toISOString(),
        linked_package_id: pkgRow.id, marketing_action_id: action.id,
        measurement: baselineMeasurement(opportunity),
      });
      return {
        confirmed: true,
        externalResourceId: pkgRow.id,
        apiResponse: { packageId: pkgRow.id, status: "awaiting_website_deployment", note: "Handoff package created — the change is NOT live until a human deploys it and marks the package deployed." },
      };
    }

    // ── Sitemap path ──
    if (actionType === "seo_sitemap_submit") {
      const { getValidGscToken, submitSitemapToGsc, fetchSitemapList } = await import("@/lib/growthmind/gsc-sync-core");
      const conn = await getValidGscToken(workspaceId);
      if (!conn.propertyUrl) return { confirmed: false, error: "No GSC property selected" };
      const origin = conn.propertyUrl.startsWith("sc-domain:")
        ? `https://${conn.propertyUrl.slice("sc-domain:".length)}`
        : conn.propertyUrl.replace(/\/$/, "");
      const sitemapUrl = String(target.sitemap_url ?? `${origin}/sitemap.xml`);
      await submitSitemapToGsc(conn.accessToken, conn.propertyUrl, sitemapUrl);
      // Read back the sitemap list as proof.
      const list = await fetchSitemapList(conn.accessToken, conn.propertyUrl);
      const found = (list ?? []).some((s: any) => String(s.path ?? "") === sitemapUrl);
      if (!found) return { confirmed: false, error: `Sitemap PUT accepted but ${sitemapUrl} not present in Search Console sitemap list read-back.` };
      await stampOpportunity(opportunityId, {
        status: "handled", status_changed_at: new Date().toISOString(),
        marketing_action_id: action.id,
        measurement: baselineMeasurement(opportunity),
      });
      return { confirmed: true, externalResourceId: sitemapUrl, apiResponse: { submitted: sitemapUrl, sitemapCount: (list ?? []).length } };
    }

    return { confirmed: false, error: `Unknown SEO action type: ${actionType}` };
  },

  async verify(action) {
    const workspaceId = action.workspace_id;
    const actionType = action.action_type as SeoActionType;
    const externalId = action.external_resource_id ?? null;

    if (CAMPAIGN_TYPES[actionType]) {
      if (!externalId) return { verified: false, note: "No campaign id recorded" };
      const { data } = await sb.from("growthmind_seo_campaigns")
        .select("id, status").eq("id", externalId).eq("workspace_id", workspaceId).maybeSingle();
      if (!data) return { verified: false, note: "Campaign row not found" };
      const failed = ["failed", "cancelled"].includes(String(data.status));
      return { verified: !failed, observedState: { campaignStatus: data.status }, note: failed ? `Campaign is ${data.status}` : `Campaign exists (status ${data.status}) — content goes live only after its own approval stages.` };
    }
    if (PACKAGE_TYPES.has(actionType)) {
      if (!externalId) return { verified: false, note: "No package id recorded" };
      const { data } = await sb.from("growthmind_seo_deployment_packages")
        .select("id, status").eq("id", externalId).eq("workspace_id", workspaceId).maybeSingle();
      if (!data) return { verified: false, note: "Deployment package row not found" };
      // What is verified here is PACKAGE DELIVERY only. The SEO change itself
      // is verified separately (markPackageDeployed → URL Inspection) once a
      // human deploys it — never here.
      return { verified: true, observedState: { verifiedScope: "handoff_package_delivery", packageStatus: data.status }, note: `Verified: handoff package delivered (status ${data.status}). The website change itself is NOT live and NOT verified — it becomes verified only after manual deployment + URL Inspection.` };
    }
    if (actionType === "seo_sitemap_submit") {
      const { getValidGscToken, fetchSitemapList } = await import("@/lib/growthmind/gsc-sync-core");
      const conn = await getValidGscToken(workspaceId);
      if (!conn.propertyUrl) return { verified: false, note: "No GSC property selected" };
      const list = await fetchSitemapList(conn.accessToken, conn.propertyUrl);
      const found = (list ?? []).some((s: any) => String(s.path ?? "") === String(externalId ?? ""));
      return { verified: found, observedState: { sitemaps: (list ?? []).map((s: any) => s.path) }, note: found ? "Sitemap present in Search Console." : "Sitemap not found in Search Console list." };
    }
    return { verified: false, note: `Unknown SEO action type: ${actionType}` };
  },

  buildRollback() {
    // SEO actions are approval-first pipelines / manual handoffs — there is no
    // safe automated compensating write. Rollback happens in the campaign /
    // package lifecycle itself.
    return null;
  },
};

registerMarketingExecutor(seoExecutor);
