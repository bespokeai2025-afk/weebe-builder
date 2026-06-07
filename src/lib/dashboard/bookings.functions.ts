import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UnifiedBooking = {
  id: string;
  source: "calcom" | "local";
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  attendee_name: string | null;
  attendee_email: string | null;
  meeting_url: string | null;
};

export function normalizeCalcomStatus(s: string | null | undefined): string {
  const v = (s ?? "").toString().toLowerCase();
  if (v === "accepted") return "confirmed";
  if (v === "rejected" || v === "cancelled" || v === "canceled") return "cancelled";
  if (v === "pending") return "pending";
  return v || "confirmed";
}

export const listBookings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        status: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(200),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    let q = supabase
      .from("calendar_bookings" as never)
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("start_at", { ascending: true })
      .limit(data.limit);
    if (data.status && data.status !== "all") q = q.eq("status", data.status as any);
    if (data.from) q = q.gte("start_at", data.from);
    if (data.to) q = q.lte("start_at", data.to);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const upsertBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        title: z.string().min(1).max(200),
        attendee_name: z.string().nullable().optional(),
        attendee_email: z.string().email().nullable().optional().or(z.literal("")),
        start_at: z.string(),
        end_at: z.string(),
        status: z.string().optional(),
        notes: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const payload: any = {
      workspace_id: workspaceId,
      source: "manual",
      title: data.title,
      attendee_name: data.attendee_name ?? null,
      attendee_email: data.attendee_email || null,
      start_at: data.start_at,
      end_at: data.end_at,
      notes: data.notes ?? null,
      ...(data.status ? { status: data.status } : {}),
    };
    if (data.id) {
      const { error } = await (supabase as any)
        .from("calendar_bookings" as never)
        .update(payload)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await (supabase as any)
      .from("calendar_bookings" as never)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const listCalendarBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const [{ data: settings, error: sErr }, { data: localRows, error: lErr }] = await Promise.all([
      supabase
        .from("workspace_settings" as never)
        .select("calcom_api_key")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("calendar_bookings" as never)
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("start_at", { ascending: true })
        .limit(500),
    ]);
    if (sErr) throw new Error(sErr.message);
    if (lErr) throw new Error(lErr.message);

    const local: UnifiedBooking[] = ((localRows ?? []) as any[]).map((b) => ({
      id: `local:${b.id}`,
      source: "local" as const,
      title: b.title,
      start_at: b.start_at,
      end_at: b.end_at ?? null,
      status: b.status,
      attendee_name: b.attendee_name ?? null,
      attendee_email: b.attendee_email ?? null,
      meeting_url: b.meeting_url ?? null,
    }));

    const token = (settings as any)?.calcom_api_key ?? null;
    let calcom: UnifiedBooking[] = [];
    let calcomError: string | null = null;
    const calcomConfigured = Boolean(token);

    if (token) {
      try {
        const url = new URL("https://api.cal.com/v1/bookings");
        url.searchParams.set("apiKey", token);
        const res = await fetch(url.toString(), {
          method: "GET",
          headers: { Accept: "application/json" },
        });
        if (!res.ok) {
          const body = await res.text().catch(() => "");
          calcomError = `Cal.com API ${res.status}: ${body.slice(0, 200) || res.statusText}`;
        } else {
          const payload: any = await res.json();
          const list: any[] = Array.isArray(payload?.bookings)
            ? payload.bookings
            : Array.isArray(payload)
              ? payload
              : [];
          calcom = list.map((b: any) => {
            const attendee =
              Array.isArray(b.attendees) && b.attendees.length > 0 ? b.attendees[0] : null;
            return {
              id: `calcom:${b.uid ?? b.id}`,
              source: "calcom" as const,
              title: b.title ?? b.eventType?.title ?? "Meeting",
              start_at: b.startTime ?? b.start ?? "",
              end_at: b.endTime ?? b.end ?? null,
              status: normalizeCalcomStatus(b.status),
              attendee_name: attendee?.name ?? null,
              attendee_email: attendee?.email ?? null,
              meeting_url:
                b.metadata?.videoCallUrl ??
                (typeof b.location === "string" ? b.location : null) ??
                (b.uid ? `https://app.cal.com/booking/${b.uid}` : null),
            };
          });
        }
      } catch (e: any) {
        calcomError = e?.message ?? "Cal.com request failed";
      }
    }

    const combined = [...calcom, ...local].filter((b) => !!b.start_at);
    combined.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    return {
      bookings: combined,
      calcomConfigured,
      calcomError,
    };
  });
