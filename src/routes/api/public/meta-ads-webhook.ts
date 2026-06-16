/**
 * GET /api/public/meta-ads-webhook  — verification challenge (hub.challenge)
 * POST /api/public/meta-ads-webhook — Meta pixel & conversion events
 *
 * Set up in Meta Business Suite → Events Manager → Webhooks → Add endpoint:
 *   https://<your-app>/api/public/meta-ads-webhook
 *   Subscriptions: lead_gen, ads_management
 *
 * Set META_WEBHOOK_VERIFY_TOKEN in your environment secrets.
 */
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const VERIFY_TOKEN = process.env.META_WEBHOOK_VERIFY_TOKEN ?? "webee-meta-verify";

export const Route = createFileRoute("/api/public/meta-ads-webhook")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url    = new URL(request.url);
        const mode   = url.searchParams.get("hub.mode");
        const token  = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge");

        if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
          console.log("[meta-ads-webhook] verification OK");
          return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
        }
        return Response.json({ ok: false, reason: "token_mismatch" }, { status: 403 });
      },

      POST: async ({ request }) => {
        let payload: any;
        try { payload = await request.json(); }
        catch { return Response.json({ error: "Bad JSON" }, { status: 400 }); }

        const object = payload?.object ?? "";
        const entries: any[] = payload?.entry ?? [];

        console.log(`[meta-ads-webhook] object=${object} entries=${entries.length}`);

        const sb = supabaseAdmin as any;
        const inserts: any[] = [];

        for (const entry of entries) {
          const adAccountId = entry.id ?? null;
          let accountRow: any = null;

          if (adAccountId) {
            const { data } = await sb
              .from("growthmind_ads_accounts")
              .select("id, workspace_id")
              .eq("platform", "meta")
              .or(`account_id.eq.${adAccountId},account_id.eq.act_${adAccountId}`)
              .maybeSingle()
              .catch(() => ({ data: null }));
            accountRow = data;
          }

          const changes: any[] = entry.changes ?? entry.messaging ?? [];
          for (const change of changes) {
            inserts.push({
              workspace_id: accountRow?.workspace_id ?? null,
              platform:     "meta",
              account_id:   accountRow?.id ?? null,
              event_type:   change.field ?? change.type ?? object,
              payload:      change.value ?? change,
              received_at:  new Date().toISOString(),
            });
          }
        }

        if (inserts.length > 0) {
          await sb.from("growthmind_ad_webhook_events").insert(inserts).catch((e: any) =>
            console.error("[meta-ads-webhook] insert error:", e?.message)
          );
        }

        return Response.json({ ok: true });
      },
    },
  },
});
