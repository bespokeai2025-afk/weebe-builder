/**
 * Cal.com webhook receiver — one URL per workspace:
 *   /api/public/calcom-webhook/<workspaceId>
 *
 * Cal.com signs each request with HMAC-SHA256(rawBody, webhookSecret) in
 * `X-Cal-Signature-256` (hex). We look up the workspace's stored secret
 * (workspace_settings.calcom_webhook_secret), verify, then upsert a
 * calendar_bookings row keyed on (workspace_id, external_id).
 *
 * Subscribed triggers: BOOKING_CREATED, BOOKING_RESCHEDULED, BOOKING_CANCELLED.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Cal-Signature-256",
} as const;

function verify(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(header.trim().toLowerCase());
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type CalPayload = {
  triggerEvent?: string;
  payload?: {
    uid?: string;
    bookingId?: number | string;
    title?: string;
    description?: string | null;
    additionalNotes?: string | null;
    startTime?: string;
    endTime?: string;
    location?: string | null;
    metadata?: { videoCallUrl?: string } | null;
    organizer?: { name?: string; email?: string; timeZone?: string };
    attendees?: Array<{
      name?: string;
      email?: string;
      timeZone?: string;
      phoneNumber?: string;
    }>;
    responses?: Record<string, { value?: unknown }>;
    cancellationReason?: string;
  };
};

function pickAttendeePhone(p: NonNullable<CalPayload["payload"]>): string | null {
  const a = p.attendees?.[0];
  if (a?.phoneNumber) return a.phoneNumber;
  const r = p.responses ?? {};
  for (const k of ["phone", "phoneNumber", "smsReminderNumber", "attendeePhoneNumber"]) {
    const v = r[k]?.value;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export const Route = createFileRoute("/api/public/calcom-webhook/$workspaceId")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      POST: async ({ request, params }) => {
        const workspaceId = params.workspaceId;
        if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) {
          return new Response("Bad workspace id", { status: 400, headers: CORS });
        }

        // Load secret for this workspace.
        const { data: settings, error: settingsErr } = await supabaseAdmin
          .from("workspace_settings")
          .select("calcom_webhook_secret")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (settingsErr) {
          return new Response("settings lookup failed", { status: 500, headers: CORS });
        }
        const secret = settings?.calcom_webhook_secret as string | null | undefined;
        if (!secret) {
          return new Response("Webhook secret not configured", {
            status: 401,
            headers: CORS,
          });
        }

        const rawBody = await request.text();
        const sig = request.headers.get("x-cal-signature-256");
        if (!verify(rawBody, sig, secret)) {
          return new Response("Invalid signature", { status: 401, headers: CORS });
        }

        let body: CalPayload;
        try {
          body = JSON.parse(rawBody);
        } catch {
          return new Response("Invalid JSON", { status: 400, headers: CORS });
        }

        const trigger = body.triggerEvent ?? "";
        const p = body.payload;
        if (!p || !p.startTime || !p.endTime) {
          return new Response("ok", { status: 200, headers: CORS });
        }

        const externalId = `calcom:${p.uid ?? p.bookingId ?? ""}`;
        if (externalId === "calcom:") {
          return new Response("ok", { status: 200, headers: CORS });
        }

        const attendee = p.attendees?.[0];
        const attendeePhone = pickAttendeePhone(p);

        // Try to link to a lead by phone or email.
        let leadId: string | null = null;
        if (attendeePhone) {
          const { data: leadByPhone } = await supabaseAdmin
            .from("leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("phone", attendeePhone)
            .maybeSingle();
          leadId = (leadByPhone?.id as string | undefined) ?? null;
        }
        if (!leadId && attendee?.email) {
          const { data: leadByEmail } = await supabaseAdmin
            .from("leads")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("email", attendee.email)
            .maybeSingle();
          leadId = (leadByEmail?.id as string | undefined) ?? null;
        }

        const status =
          trigger === "BOOKING_CANCELLED"
            ? "cancelled"
            : trigger === "BOOKING_RESCHEDULED"
              ? "rescheduled"
              : "accepted";

        const row = {
          workspace_id: workspaceId,
          lead_id: leadId,
          external_id: externalId,
          source: "calcom",
          title: p.title ?? "Cal.com booking",
          description: p.description ?? p.additionalNotes ?? null,
          start_at: new Date(p.startTime).toISOString(),
          end_at: new Date(p.endTime).toISOString(),
          attendee_name: attendee?.name ?? null,
          attendee_email: attendee?.email ?? null,
          attendee_phone: attendeePhone,
          meeting_url: p.metadata?.videoCallUrl ?? null,
          notes: trigger === "BOOKING_CANCELLED" ? (p.cancellationReason ?? null) : null,
          status,
        };

        // Manual upsert: check if a row for this (workspace_id, external_id)
        // already exists, then update or insert. This avoids relying on a
        // specific ON CONFLICT constraint definition in the DB.
        const { data: existing } = await supabaseAdmin
          .from("calendar_bookings")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("external_id", externalId)
          .maybeSingle();

        if (existing?.id) {
          const { error } = await supabaseAdmin
            .from("calendar_bookings")
            .update({ ...row, updated_at: new Date().toISOString() } as never)
            .eq("id", existing.id);
          if (error) {
            console.error("[calcom-webhook] update failed", error.message, { trigger });
            return new Response("db error", { status: 500, headers: CORS });
          }
        } else {
          const { error } = await supabaseAdmin
            .from("calendar_bookings")
            .insert(row as never);
          if (error) {
            console.error("[calcom-webhook] insert failed", error.message, { trigger });
            return new Response("db error", { status: 500, headers: CORS });
          }
        }

        return new Response("ok", { status: 200, headers: CORS });
      },
    },
  },
});
