/**
 * WEBEE Developer API v1 — Campaigns
 * POST /api/v1/campaigns/trigger — enrol lead into campaign (campaigns:trigger)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/campaigns")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "campaigns:trigger");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { campaign_id, lead_id, phone, name } = body ?? {};
        if (!campaign_id) return jsonErr("campaign_id is required");
        if (!lead_id && !phone) return jsonErr("Either lead_id or phone is required");

        // Verify campaign belongs to workspace
        const { data: campaign } = await sb().from("call_campaigns")
          .select("id, name, status, agent_id")
          .eq("id", campaign_id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (!campaign) return jsonErr("Campaign not found", 404);
        if (campaign.status === "completed") return jsonErr("Campaign is already completed", 422);

        // Resolve or create lead
        let resolvedLeadId = lead_id;
        if (!resolvedLeadId && phone) {
          const { data: existing } = await sb().from("leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("phone", phone)
            .maybeSingle();

          if (existing) {
            resolvedLeadId = existing.id;
          } else {
            const { data: newLead } = await sb().from("leads").insert({
              workspace_id: workspaceId,
              phone,
              full_name: name ?? null,
              name:      name ?? null,
              source:    "api",
              status:    "new",
            }).select("id").single();
            resolvedLeadId = newLead?.id;
          }
        }

        if (!resolvedLeadId) return jsonErr("Could not resolve lead", 500);

        // Check if lead already enrolled
        const { data: existingEnrolment } = await sb().from("campaign_leads")
          .select("id, status")
          .eq("campaign_id", campaign_id)
          .eq("lead_id", resolvedLeadId)
          .maybeSingle();

        if (existingEnrolment) {
          return jsonOk({
            object:      "campaign_enrolment",
            campaign_id,
            lead_id:     resolvedLeadId,
            status:      existingEnrolment.status,
            enrolled:    false,
            message:     "Lead already enrolled in this campaign",
          });
        }

        await sb().from("campaign_leads").insert({
          campaign_id,
          lead_id:      resolvedLeadId,
          workspace_id: workspaceId,
          status:       "pending",
          added_via:    "api",
        });

        // Fire webhook
        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "campaign.completed", { campaign_id, lead_id: resolvedLeadId }))
          .catch(() => {});

        return jsonOk({
          object:      "campaign_enrolment",
          campaign_id,
          lead_id:     resolvedLeadId,
          status:      "pending",
          enrolled:    true,
        }, 201);
      },
    },
  },
});
