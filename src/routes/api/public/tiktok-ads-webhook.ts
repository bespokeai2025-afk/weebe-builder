/**
 * GET  /api/public/tiktok-ads-webhook — TikTok challenge verification
 * POST /api/public/tiktok-ads-webhook — TikTok conversion & event data
 *
 * Set up in TikTok Business Centre → Developer → Webhook:
 *   https://<your-app>/api/public/tiktok-ads-webhook
 *
 * Set TIKTOK_WEBHOOK_VERIFY_TOKEN in environment secrets.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VERIFY_TOKEN = process.env.TIKTOK_WEBHOOK_VERIFY_TOKEN ?? "webee-tiktok-verify";

export const Route = createFileRoute("/api/public/tiktok-ads-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url       = new URL(request.url);
        const challenge = url.searchParams.get("challenge");
        const token     = url.searchParams.get("verify_token");

        if (challenge && token === VERIFY_TOKEN) {
          return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        if (challenge) {
          return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return Response.json({ ok: true, endpoint: "tiktok-ads-webhook" });
      },

      POST: async ({ request }) => {
        let payload: any;
        try { payload = await request.json(); }
        catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }

        const sb = supabaseAdmin as any;
        const advertiserId = String(payload?.advertiser_id ?? payload?.data?.advertiser_id ?? "");

        let accountRow: any = null;
        if (advertiserId) {
          const { data } = await sb
            .from("growthmind_ads_accounts")
            .select("id, workspace_id")
            .eq("platform", "tiktok")
            .eq("account_id", advertiserId)
            .maybeSingle()
            .catch(() => ({ data: null }));
          accountRow = data;
        }

        const eventType = String(payload?.event_type ?? payload?.type ?? "event");

        await sb.from("growthmind_ad_webhook_events").insert({
          workspace_id: accountRow?.workspace_id ?? null,
          platform:     "tiktok",
          account_id:   accountRow?.id ?? null,
          event_type:   eventType,
          payload,
          received_at:  new Date().toISOString(),
        }).catch((e: any) => console.error("[tiktok-ads-webhook] insert error:", e?.message));

        console.log(`[tiktok-ads-webhook] ${eventType} for advertiser=${advertiserId}`);
        return Response.json({ ok: true });
      },
    },
  },
});
