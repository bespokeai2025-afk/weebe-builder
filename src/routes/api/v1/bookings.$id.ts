/**
 * WEBEE Developer API v1 — Booking by ID
 * GET   /api/v1/bookings/:id — get booking (bookings:read)
 * PATCH /api/v1/bookings/:id — update booking (bookings:write)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const BOOKING_SELECT = "id, status, start_at, end_at, attendee_name, attendee_email, attendee_phone, meeting_url, notes, agent_id, call_id, external_id, created_at, updated_at";

export const Route = createFileRoute("/api/v1/bookings/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const auth = await authenticateV1Request(request, "bookings:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;
        const { id } = params as { id: string };

        const { data, error } = await (sb() as any).from("calendar_bookings")
          .select(BOOKING_SELECT)
          .eq("id", id)
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!data) return jsonErr("Booking not found", 404);
        return jsonOk({ object: "booking", ...data });
      },

      PATCH: async ({ request, params }) => {
        const auth = await authenticateV1Request(request, "bookings:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;
        const { id } = params as { id: string };

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const allowed = ["status", "start_at", "end_at", "attendee_name", "attendee_email", "attendee_phone", "meeting_url", "notes"] as const;
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        for (const key of allowed) {
          if (body[key] !== undefined) patch[key] = body[key];
        }

        if (Object.keys(patch).length === 1) return jsonErr("No updatable fields provided");

        const { data, error } = await (sb() as any).from("calendar_bookings")
          .update(patch)
          .eq("id", id)
          .eq("workspace_id", workspaceId)
          .select(BOOKING_SELECT)
          .maybeSingle();

        if (error) return jsonErr(error.message, 500);
        if (!data) return jsonErr("Booking not found", 404);

        const eventType = body.status === "cancelled" ? "booking.cancelled" : "booking.updated";
        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, eventType, data))
          .catch(() => {});

        return jsonOk({ object: "booking", ...data });
      },
    },
  },
});
