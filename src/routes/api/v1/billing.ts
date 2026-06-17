/**
 * WEBEE Developer API v1 — Billing
 * GET /api/v1/billing — workspace billing profile & plan (billing:read)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/billing")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "billing:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const client = sb() as any;

        const [profileRes, monthlyRes] = await Promise.all([
          client.from("client_billing_profiles")
            .select("monthly_charge_cents, currency, billing_cycle, included_minutes, included_messages, included_video_seconds, included_email_sends, included_storage_mb, overage_rates_json, contract_start_date, contract_end_date, status, notes")
            .eq("workspace_id", workspaceId)
            .maybeSingle(),
          client.from("client_monthly_costs")
            .select("month, total_cost_usd, voice_cost_usd, llm_cost_usd, email_cost_usd, video_cost_usd, storage_cost_usd")
            .eq("workspace_id", workspaceId)
            .order("month", { ascending: false })
            .limit(3),
        ]);

        const profile = profileRes.data;
        const recent  = monthlyRes.data ?? [];

        return jsonOk({
          object: "billing",
          plan: profile ? {
            monthly_charge_usd:       profile.monthly_charge_cents != null ? profile.monthly_charge_cents / 100 : null,
            currency:                 profile.currency,
            billing_cycle:            profile.billing_cycle,
            included_minutes:         profile.included_minutes,
            included_messages:        profile.included_messages,
            included_video_seconds:   profile.included_video_seconds,
            included_email_sends:     profile.included_email_sends,
            included_storage_mb:      profile.included_storage_mb,
            overage_rates:            profile.overage_rates_json,
            contract_start_date:      profile.contract_start_date,
            contract_end_date:        profile.contract_end_date,
            status:                   profile.status,
          } : null,
          recent_months: recent.map((m: any) => ({
            month:         m.month,
            total_usd:     m.total_cost_usd,
            voice_usd:     m.voice_cost_usd,
            llm_usd:       m.llm_cost_usd,
            email_usd:     m.email_cost_usd,
            video_usd:     m.video_cost_usd,
            storage_usd:   m.storage_cost_usd,
          })),
        });
      },
    },
  },
});
