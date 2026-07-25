/**
 * WEBEE Developer API v1 — SEO Department (mobile parity, §15)
 *
 * GET /api/v1/seo — full SEO record snapshot for the workspace (growthmind:read):
 *   connection status, property, data-processing state, sync state, sitemaps,
 *   recent URL inspections, campaigns (briefs/articles/blockers/approvals) and
 *   deployment packages. Same records as the web SEO Department — no
 *   mobile-only data.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/seo")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "growthmind:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url = new URL(request.url);
        const includeCampaigns = url.searchParams.get("campaigns") !== "false";
        const client = sb();

        try {
          const { getSyncStateForWorkspace, auditSitemaps, listStoredInspections } =
            await import("@/lib/growthmind/seo-intelligence.server");

          const [state, sitemaps, inspections] = await Promise.all([
            getSyncStateForWorkspace(workspaceId),
            auditSitemaps(workspaceId),
            listStoredInspections(workspaceId, 20),
          ]);

          let campaigns: any[] = [];
          let packages: any[] = [];
          if (includeCampaigns) {
            const [c, p] = await Promise.all([
              client.from("growthmind_seo_campaigns")
                .select("id, name, campaign_type, status, primary_topic, page_decision, page_decision_reason, proposed_url, proposed_title, meta_title, meta_description, blocked_reason, data_limitations, approvals, created_at, updated_at")
                .eq("workspace_id", workspaceId)
                .order("updated_at", { ascending: false })
                .limit(50),
              client.from("growthmind_seo_deployment_packages")
                .select("id, campaign_id, status, page_mode, proposed_route, live_url, verified_at, created_at")
                .eq("workspace_id", workspaceId)
                .order("created_at", { ascending: false })
                .limit(50),
            ]);
            if (c.error) return jsonErr(c.error.message, 500);
            if (p.error) return jsonErr(p.error.message, 500);
            campaigns = c.data ?? [];
            packages = p.data ?? [];
          }

          // Public content publishing state (§16 mobile parity — same records as web)
          let publicContent: any = null;
          try {
            const { data: site } = await client
              .from("growthmind_public_sites")
              .select("id, site_key, canonical_host, status, allowed_origins")
              .eq("workspace_id", workspaceId)
              .eq("status", "active")
              .limit(1)
              .maybeSingle();
            if (site) {
              const [items, execs] = await Promise.all([
                client.from("growthmind_public_content_items")
                  .select("id, slug, title, status, content_type, category, scheduled_for, published_at, live_verification_state, current_version, updated_at")
                  .eq("workspace_id", workspaceId)
                  .order("updated_at", { ascending: false })
                  .limit(100),
                client.from("growthmind_publication_executions")
                  .select("id, item_id, kind, status, scheduled_for, attempts, error_message, completed_at, created_at")
                  .eq("workspace_id", workspaceId)
                  .order("created_at", { ascending: false })
                  .limit(50),
              ]);
              publicContent = {
                site: { site_key: site.site_key, canonical_host: site.canonical_host },
                api_base: `/api/public/v1/sites/${site.site_key}`,
                sitemap_state: "Missing — awaiting Lovable implementation (sitemap-data endpoint ready)",
                publication_capability: "API Only — articles are 'API Published — Awaiting Lovable Frontend' until live verification succeeds",
                articles: items.data ?? [],
                executions: execs.data ?? [],
              };
            }
          } catch { /* section is additive — never break the snapshot */ }

          return jsonOk({
            object: "seo_snapshot",
            connection: {
              connected: state.connected,
              property_url: state.propertyUrl,
            },
            sync: state.state,
            sitemaps: sitemaps.deliverables,
            recent_inspections: inspections,
            campaigns,
            deployment_packages: packages,
            public_content: publicContent,
            approval_model:
              "Strategy, brief, article, deployment package and website deployment each require separate explicit approval. Publication is a manual Lovable deployment; live status is only set after URL verification.",
          });
        } catch (e: any) {
          return jsonErr(e?.message ?? "SEO snapshot failed", 500);
        }
      },
    },
  },
});
