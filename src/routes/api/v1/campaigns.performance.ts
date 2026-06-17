/**
 * WEBEE Developer API v1 — Campaign Performance
 * GET /api/v1/campaigns/performance — per-campaign stats (campaigns:read)
 *
 * Query params: ?campaign_id=, ?days=30, ?limit=20
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/campaigns/performance")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "campaigns:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url        = new URL(request.url);
        const days       = Math.min(parseInt(url.searchParams.get("days") ?? "30"), 365);
        const campaignId = url.searchParams.get("campaign_id");
        const limit      = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 100);
        const since      = new Date(Date.now() - days * 86_400_000).toISOString();

        const client = sb() as any;

        // Fetch campaigns
        let campaignQ = client.from("campaigns")
          .select("id, name, status, created_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (campaignId) campaignQ = campaignQ.eq("id", campaignId);

        const { data: campaigns, error: campErr } = await campaignQ;
        if (campErr) return jsonErr(campErr.message, 500);

        // Fetch enrolments for the window
        let enrolQ = client.from("campaign_contacts")
          .select("campaign_id, status, created_at")
          .in("campaign_id", (campaigns ?? []).map((c: any) => c.id))
          .gte("created_at", since);

        const { data: enrolments } = await enrolQ;
        const enrolled = (enrolments ?? []) as any[];

        const stats = (campaigns ?? []).map((c: any) => {
          const rows  = enrolled.filter((e: any) => e.campaign_id === c.id);
          const done  = rows.filter((e: any) => ["completed", "called", "booked"].includes(e.status)).length;
          const rate  = rows.length > 0 ? Math.round((done / rows.length) * 100) : 0;
          return {
            id:              c.id,
            name:            c.name,
            status:          c.status,
            period_days:     days,
            total_enrolled:  rows.length,
            completed:       done,
            pending:         rows.filter((e: any) => e.status === "pending").length,
            failed:          rows.filter((e: any) => e.status === "failed").length,
            completion_rate: rate,
            created_at:      c.created_at,
          };
        });

        return jsonOk({ object: "list", data: stats, period_days: days });
      },
    },
  },
});
