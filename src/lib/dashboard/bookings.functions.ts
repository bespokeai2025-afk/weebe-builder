import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { calFetch, cancelBooking as calcomCancelBooking } from "@/lib/calendar/calcom.server";
import { invalidateDashboardCache } from "@/lib/cache/redis.server";
import { getWbahCalendarBookings } from "@/lib/integrations/webespokeEnterprise/wbah-leads.server";

export type UnifiedBooking = {
  id: string;
  source: "calcom" | "local" | "wbah";
  title: string;
  start_at: string;
  end_at: string | null;
  status: string;
  attendee_name: string | null;
  attendee_email: string | null;
  attendee_phone?: string | null;
  meeting_url: string | null;
  db_id: string | null;
  external_id: string | null;
  notes: string | null;
  agent_name: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
};

export type BookingDetail = {
  booking: UnifiedBooking;
  summary: {
    summary: string | null;
    appointment_reason: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    appointment_date: string | null;
    appointment_booked: boolean | null;
  } | null;
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
      invalidateDashboardCache(workspaceId);
      return { id: data.id };
    }
    const { data: row, error } = await (supabase as any)
      .from("calendar_bookings" as never)
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    invalidateDashboardCache(workspaceId);
    return { id: row!.id as string };
  });

export const listCalendarBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: wsRow } = await (supabase as any)
      .from("workspaces")
      .select("slug")
      .eq("id", workspaceId)
      .maybeSingle();
    const isWbah = wsRow?.slug === "webuyanyhouse";

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
      db_id: b.id as string,
      external_id: b.external_id ?? null,
      notes: b.notes ?? null,
      agent_name: null,
    }));

    const token = (settings as any)?.calcom_api_key ?? null;
    let calcom: UnifiedBooking[] = [];
    let calcomError: string | null = null;
    const calcomConfigured = Boolean(token);

    if (token) {
      try {
        const payload = await calFetch<{ bookings?: any[] } | any[]>(token, "/bookings", {
          apiVersion: "2024-08-13",
        });
        const list: any[] = Array.isArray(payload)
          ? payload
          : Array.isArray((payload as any)?.bookings)
            ? (payload as any).bookings
            : [];

        // Collect all calcom UIDs so we can look up agent names in bulk
        const calcomUids = list
          .map((b: any) => b.uid ?? b.id)
          .filter(Boolean)
          .map(String);

        // Fetch booking_summaries and agents in parallel to resolve agent names
        const [{ data: summaryRows }, { data: agentRows }] = await Promise.all([
          calcomUids.length > 0
            ? (supabase as any)
                .from("booking_summaries" as never)
                .select("calcom_booking_uid,agent_id")
                .in("calcom_booking_uid", calcomUids)
            : Promise.resolve({ data: [] }),
          (supabase as any)
            .from("agents" as never)
            .select("id,name")
            .eq("workspace_id", workspaceId),
        ]);

        // Build uid → agent_name lookup
        const agentNameById: Record<string, string> = {};
        for (const a of (agentRows ?? []) as any[]) {
          if (a.id && a.name) agentNameById[a.id] = a.name;
        }
        const uidToAgentName: Record<string, string | null> = {};
        for (const s of (summaryRows ?? []) as any[]) {
          if (s.calcom_booking_uid && s.agent_id) {
            uidToAgentName[s.calcom_booking_uid] = agentNameById[s.agent_id] ?? null;
          }
        }

        calcom = list.map((b: any) => {
          const attendee =
            Array.isArray(b.attendees) && b.attendees.length > 0 ? b.attendees[0] : null;
          const calcomUid = b.uid ?? b.id ?? null;
          const uidStr = calcomUid ? String(calcomUid) : null;
          // Check if there's a local calendar_bookings row for this calcom booking
          const localMatch = ((localRows ?? []) as any[]).find(
            (r) => r.external_id === uidStr,
          );
          return {
            id: `calcom:${calcomUid}`,
            source: "calcom" as const,
            title: b.title ?? b.eventType?.title ?? "Meeting",
            start_at: b.start ?? b.startTime ?? "",
            end_at: b.end ?? b.endTime ?? null,
            status: normalizeCalcomStatus(b.status),
            attendee_name: attendee?.name ?? null,
            attendee_email: attendee?.email ?? null,
            meeting_url:
              b.metadata?.videoCallUrl ??
              (typeof b.location === "string" ? b.location : null) ??
              (calcomUid ? `https://app.cal.com/booking/${calcomUid}` : null),
            db_id: localMatch?.id ?? null,
            external_id: uidStr,
            notes: localMatch?.notes ?? null,
            agent_name: uidStr ? (uidToAgentName[uidStr] ?? null) : null,
          };
        });
      } catch (e: any) {
        calcomError = e?.message ?? "Cal.com request failed";
      }
    }

    // Collect external_ids already covered by Cal.com results
    const calcomExternalIds = new Set(calcom.map((b) => b.external_id).filter(Boolean));

    // Include manual bookings that are NOT already represented by a Cal.com entry
    const manualBookings: UnifiedBooking[] = ((localRows ?? []) as any[])
      .filter(
        (b) =>
          b.source === "manual" &&
          b.start_at &&
          (!b.external_id || !calcomExternalIds.has(b.external_id)),
      )
      .map((b) => ({
        id: `local:${b.id}`,
        source: "local" as const,
        title: b.title,
        start_at: b.start_at,
        end_at: b.end_at ?? null,
        status: b.status ?? "confirmed",
        attendee_name: b.attendee_name ?? null,
        attendee_email: b.attendee_email ?? null,
        meeting_url: b.meeting_url ?? null,
        db_id: b.id as string,
        external_id: b.external_id ?? null,
        notes: b.notes ?? null,
        agent_name: null,
      }));

    const combined = [...calcom, ...manualBookings].filter((b) => !!b.start_at);

    let wbahBookings: UnifiedBooking[] = [];
    if (isWbah) {
      try {
        const { cacheDel } = await import("@/lib/cache/redis.server");
        await cacheDel(`webee:wbah-calls-aggregate:v5:${workspaceId}`);
        const wbahRows = await getWbahCalendarBookings(workspaceId);
        wbahBookings = wbahRows.map((b) => ({
          id: `wbah:${b.id}`,
          source: "wbah" as const,
          title: b.title,
          start_at: b.start_at,
          end_at: b.end_at,
          status: b.status,
          attendee_name: b.attendee_name,
          attendee_email: null,
          attendee_phone: b.attendee_phone,
          meeting_url: b.meeting_url,
          db_id: null,
          external_id: `wbah:${b.id}`,
          notes: null,
          agent_name: b.agent_name,
          appointment_date: b.appointment_date,
          appointment_time: b.appointment_time,
        }));
      } catch (e: any) {
        console.warn("[listCalendarBookings] WBAH calendar load failed:", e?.message ?? e);
      }
    }

    const merged = [...combined, ...wbahBookings].filter((b) => !!b.start_at);
    merged.sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime());

    return {
      bookings: merged,
      calcomConfigured,
      calcomError,
      isWbah,
    };
  });

export const getBookingDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        db_id: z.string().uuid().optional(),
        external_id: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    let bookingRow: any = null;

    if (data.db_id) {
      const { data: row } = await (supabase as any)
        .from("calendar_bookings" as never)
        .select("*")
        .eq("id", data.db_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      bookingRow = row;
    } else if (data.external_id) {
      const { data: row } = await (supabase as any)
        .from("calendar_bookings" as never)
        .select("*")
        .eq("external_id", data.external_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      bookingRow = row;
    }

    // Fetch booking summary
    let summaryRow: any = null;
    if (bookingRow?.id) {
      const { data: s } = await (supabase as any)
        .from("booking_summaries" as never)
        .select("summary,appointment_reason,customer_name,customer_phone,appointment_date,appointment_booked")
        .eq("booking_id", bookingRow.id)
        .maybeSingle();
      summaryRow = s;
    }
    if (!summaryRow && data.external_id) {
      const { data: s } = await (supabase as any)
        .from("booking_summaries" as never)
        .select("summary,appointment_reason,customer_name,customer_phone,appointment_date,appointment_booked")
        .eq("calcom_booking_uid", data.external_id)
        .maybeSingle();
      summaryRow = s;
    }

    return {
      notes: (bookingRow?.notes ?? null) as string | null,
      db_id: (bookingRow?.id ?? null) as string | null,
      summary: summaryRow
        ? {
            summary: summaryRow.summary ?? null,
            appointment_reason: summaryRow.appointment_reason ?? null,
            customer_name: summaryRow.customer_name ?? null,
            customer_phone: summaryRow.customer_phone ?? null,
            appointment_date: summaryRow.appointment_date ?? null,
            appointment_booked: summaryRow.appointment_booked ?? null,
          }
        : null,
    };
  });

export const updateBookingNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        db_id: z.string().uuid().optional(),
        external_id: z.string().optional(),
        title: z.string().optional(),
        attendee_name: z.string().nullable().optional(),
        attendee_email: z.string().nullable().optional(),
        start_at: z.string().optional(),
        notes: z.string(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    if (data.db_id) {
      const { error } = await (supabase as any)
        .from("calendar_bookings" as never)
        .update({ notes: data.notes })
        .eq("id", data.db_id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      invalidateDashboardCache(workspaceId);
      return { ok: true };
    }

    if (data.external_id) {
      // Try to find existing local row for this calcom booking
      const { data: existing } = await (supabase as any)
        .from("calendar_bookings" as never)
        .select("id")
        .eq("external_id", data.external_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();

      if (existing?.id) {
        await (supabase as any)
          .from("calendar_bookings" as never)
          .update({ notes: data.notes })
          .eq("id", existing.id);
      } else {
        // Create a local shadow row to hold the notes
        await (supabase as any)
          .from("calendar_bookings" as never)
          .insert({
            workspace_id: workspaceId,
            source: "calcom",
            external_id: data.external_id,
            title: data.title ?? "Meeting",
            attendee_name: data.attendee_name ?? null,
            attendee_email: data.attendee_email ?? null,
            start_at: data.start_at ?? new Date().toISOString(),
            notes: data.notes,
          });
      }
      invalidateDashboardCache(workspaceId);
      return { ok: true };
    }

    throw new Error("Either db_id or external_id is required");
  });

export const cancelBookingFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        db_id: z.string().uuid().optional(),
        external_id: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    // Resolve db_id if we only have external_id
    let resolvedDbId = data.db_id;
    if (!resolvedDbId && data.external_id) {
      const { data: row } = await (supabase as any)
        .from("calendar_bookings" as never)
        .select("id")
        .eq("external_id", data.external_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      resolvedDbId = row?.id;
    }

    // If it's a real Cal.com booking, cancel via the API
    const calcomUid = data.external_id && !data.external_id.startsWith("retell-call:")
      ? data.external_id
      : null;

    if (calcomUid) {
      const { data: settings } = await (supabase as any)
        .from("workspace_settings" as never)
        .select("calcom_api_key")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      const apiKey: string | null = (settings as any)?.calcom_api_key ?? null;
      if (apiKey) {
        await calcomCancelBooking(apiKey, calcomUid, data.reason ?? "Cancelled via dashboard");
      }
    }

    // Always mark the local row as cancelled
    if (resolvedDbId) {
      await (supabase as any)
        .from("calendar_bookings" as never)
        .update({ status: "cancelled" })
        .eq("id", resolvedDbId)
        .eq("workspace_id", workspaceId);
    }

    invalidateDashboardCache(workspaceId);
    return { ok: true };
  });
