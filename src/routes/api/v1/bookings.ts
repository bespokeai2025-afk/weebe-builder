/**
 * WEBEE Developer API v1 — Bookings
 * GET  /api/v1/bookings — list bookings (bookings:read)
 * POST /api/v1/bookings — create booking (bookings:write)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const BOOKING_SELECT = "id, status, start_at, end_at, attendee_name, attendee_email, attendee_phone, meeting_url, notes, agent_id, call_id, external_id, created_at, updated_at";

export const Route = createFileRoute("/api/v1/bookings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = await authenticateV1Request(request, "bookings:read");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        const url    = new URL(request.url);
        const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);
        const offset = parseInt(url.searchParams.get("offset") ?? "0");
        const status = url.searchParams.get("status");
        const since  = url.searchParams.get("since");
        const until  = url.searchParams.get("until");

        let q = (sb() as any).from("calendar_bookings")
          .select(BOOKING_SELECT)
          .eq("workspace_id", workspaceId)
          .order("start_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) q = q.eq("status", status);
        if (since)  q = q.gte("start_at", since);
        if (until)  q = q.lte("start_at", until);

        const { data, error } = await q;
        if (error) return jsonErr(error.message, 500);

        return jsonOk({ object: "list", data: data ?? [], limit, offset });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "bookings:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); } catch { return jsonErr("Invalid JSON body"); }

        const { attendee_name, attendee_email, attendee_phone, start_at, end_at, agent_id, notes, meeting_url } = body ?? {};
        if (!start_at) return jsonErr("start_at is required (ISO 8601)");
        if (!attendee_name && !attendee_email) return jsonErr("attendee_name or attendee_email is required");

        const now = new Date().toISOString();
        const { data, error } = await (sb() as any).from("calendar_bookings").insert({
          workspace_id:    workspaceId,
          status:          "confirmed",
          start_at,
          end_at:          end_at ?? null,
          attendee_name:   attendee_name ?? null,
          attendee_email:  attendee_email ?? null,
          attendee_phone:  attendee_phone ?? null,
          meeting_url:     meeting_url ?? null,
          notes:           notes ?? null,
          agent_id:        agent_id ?? null,
          created_at:      now,
          updated_at:      now,
        }).select(BOOKING_SELECT).single();

        if (error) return jsonErr(error.message, 500);

        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "booking.created", data))
          .catch(() => {});

        return jsonOk({ object: "booking", ...data }, 201);
      },
    },
  },
});
