/**
 * WEBEE Developer API v1 — Contacts
 * GET  /api/v1/contacts — list contacts (contacts:read)
 * POST /api/v1/contacts — create contact (contacts:write)
 *
 * Contacts are backed by the same `leads` table.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const CONTACT_SELECT = "id, full_name, name, phone, email, status, pipeline_stage, source, notes, tags, created_at, updated_at";

export const Route = createFileRoute("/api/v1/contacts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "contacts:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url    = new URL(request.url);
        const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        const search = url.searchParams.get("q");
        const tag    = url.searchParams.get("tag");

        let q = sb().from("leads")
          .select(CONTACT_SELECT)
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (search) {
          q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`);
        }
        if (tag) {
          q = (q as any).contains("tags", [tag]);
        }

        const { data, error } = await q;
        if (error) return jsonErr(error.message, 500);

        const contacts = (data ?? []).map(formatContact);
        return jsonOk({ object: "list", data: contacts, limit, offset });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "contacts:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const { full_name, name, phone, email, source, notes, tags, pipeline_stage } = body ?? {};
        const contactName = full_name ?? name;
        if (!contactName && !phone && !email) {
          return jsonErr("At least one of: full_name, phone, email is required");
        }

        const { toLeadSourceEnum } = await import("@/lib/lead-gen/webforms.server");
        const now = new Date().toISOString();
        const { data, error } = await sb().from("leads").insert({
          workspace_id:   workspaceId,
          full_name:      contactName ?? null,
          name:           contactName ?? null,
          phone:          phone       ?? null,
          email:          email       ?? null,
          source:         toLeadSourceEnum(source ?? "api", "api"),
          notes:          notes       ?? null,
          tags:           tags        ?? null,
          pipeline_stage: pipeline_stage ?? null,
          status:         "need_to_call",
          created_at:     now,
          updated_at:     now,
        }).select(CONTACT_SELECT).single();

        if (error) return jsonErr(error.message, 500);

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "lead.created", data))
          .catch(() => {});

        // New-lead notification — best-effort, never throws.
        import("@/lib/lead-gen/lead-notify.server")
          .then(m => m.notifyNewLead({
            workspaceId, leadId: data.id,
            name: contactName ?? null, phone: phone ?? null, email: email ?? null,
            source: "API (contact)",
          }))
          .catch(() => {});

        // Auto-call automation — best-effort, never throws.
        const { triggerAutoCallForNewLead } = await import("@/lib/qualification/auto-call.server");
        await triggerAutoCallForNewLead(sb(), { workspaceId, leadId: data.id });

        return jsonOk({ object: "contact", ...formatContact(data) }, 201);
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
