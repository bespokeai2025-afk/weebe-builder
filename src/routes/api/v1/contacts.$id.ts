/**
 * WEBEE Developer API v1 — Contact by ID
 * GET   /api/v1/contacts/:id — get contact (contacts:read)
 * PATCH /api/v1/contacts/:id — update contact (contacts:write)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const CONTACT_SELECT = "id, full_name, name, phone, email, status, pipeline_stage, source, notes, tags, created_at, updated_at";

export const Route = createFileRoute("/api/v1/contacts/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await authenticateV1Request(request, "contacts:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;
        const { id } = params as { id: string };

        const { data, error } = await sb().from("leads")
          .select(CONTACT_SELECT)
          .eq("id", id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!data) return jsonErr("Contact not found", 404);

        return jsonOk({ object: "contact", ...formatContact(data) });
      },

      PATCH: async ({ request, params }) => {
        const auth = await authenticateV1Request(request, "contacts:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;
        const { id } = params as { id: string };

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const allowed = ["full_name", "name", "phone", "email", "status", "pipeline_stage", "source", "notes", "tags"] as const;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (body[key] !== undefined) {
            patch[key] = body[key];
            if (key === "full_name") patch.name = body[key];
            if (key === "name") patch.full_name = body[key];
          }
        }

        if (Object.keys(patch).length === 1) return jsonErr("No updatable fields provided");

        const { data, error } = await sb().from("leads")
          .update(patch)
          .eq("id", id)
          .eq("workspace_id", workspaceId)
          .select(CONTACT_SELECT)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!data) return jsonErr("Contact not found", 404);

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "lead.updated", data))
          .catch(() => {});

        return jsonOk({ object: "contact", ...formatContact(data) });
      },
    },
  },
});

function formatContact(row: any) {
  return {
    id:             row.id,
    full_name:      row.full_name ?? row.name ?? null,
    phone:          row.phone     ?? null,
    email:          row.email     ?? null,
    status:         row.status    ?? null,
    pipeline_stage: row.pipeline_stage ?? null,
    source:         row.source    ?? null,
    notes:          row.notes     ?? null,
    tags:           row.tags      ?? [],
    created_at:     row.created_at,
    updated_at:     row.updated_at,
  };
}
