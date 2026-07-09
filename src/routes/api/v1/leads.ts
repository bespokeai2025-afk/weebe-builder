/**
 * WEBEE Developer API v1 — Leads
 * GET  /api/v1/leads        — list leads (leads:read)
 * POST /api/v1/leads        — create lead (leads:write)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "leads:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url     = new URL(request.url);
        const limit   = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset  = parseInt(url.searchParams.get("offset") ?? "0");
        const status  = url.searchParams.get("status");

        let q = sb().from("leads")
          .select("id, full_name, name, phone, email, status, pipeline_stage, source, created_at, updated_at")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) q = q.eq("status", status);

        const { data, error } = await q;
        if (error) return jsonErr(error.message, 500);

        return jsonOk({ object: "list", data: data ?? [], limit, offset });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "leads:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { name, full_name, phone, email, source, status, pipeline_stage, notes } = body ?? {};
        const leadName = full_name ?? name;
        if (!leadName && !phone && !email) {
          return jsonErr("At least one of: full_name, phone, email is required");
        }

        const { data, error } = await sb().from("leads").insert({
          workspace_id:    workspaceId,
          full_name:       leadName ?? null,
          name:            leadName ?? null,
          phone:           phone    ?? null,
          email:           email    ?? null,
          source:          source   ?? "api",
          status:          status   ?? "new",
          pipeline_stage:  pipeline_stage ?? null,
          notes:           notes ?? null,
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        }).select("id, full_name, phone, email, status, source, created_at").single();

        if (error) return jsonErr(error.message, 500);

        // Fire webhook event (fire-and-forget)
        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "lead.created", data))
          .catch(() => {});

        // Auto-call automation — best-effort, never throws.
        const { triggerAutoCallForNewLead } = await import("@/lib/qualification/auto-call.server");
        await triggerAutoCallForNewLead(sb(), { workspaceId, leadId: data.id });

        return jsonOk({ object: "lead", ...data }, 201);
      },
    },
  },
});
