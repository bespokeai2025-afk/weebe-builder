import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createBooking, getCalcomUserTimezone } from "@/lib/calendar/calcom.server";

const ENTITY_TYPES = ["lead", "contact", "call"] as const;

export const addEntityNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        entityType: z.enum(ENTITY_TYPES),
        entityId: z.string().uuid(),
        body: z.string().min(1).max(5000).trim(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await (supabase as any)
      .from("entity_notes")
      .insert({
        workspace_id: workspaceId,
        entity_type: data.entityType,
        entity_id: data.entityId,
        body: data.body,
      });
    if (error) {
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        throw new Error("MIGRATION_NEEDED");
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const listEntityNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        entityType: z.enum(ENTITY_TYPES),
        entityId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: rows, error } = await (supabase as any)
      .from("entity_notes")
      .select("id, body, created_at")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", data.entityType)
      .eq("entity_id", data.entityId)
      .order("created_at", { ascending: false });
    if (error) {
      // Table may not exist yet — return empty rather than crashing
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        return [] as { id: string; body: string; created_at: string }[];
      }
      throw new Error(error.message);
    }
    return (rows ?? []) as { id: string; body: string; created_at: string }[];
  });

export const deleteEntityNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await (supabase as any)
      .from("entity_notes")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createManualBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().min(1).max(200),
        attendeeName: z.string().nullable().optional(),
        attendeePhone: z.string().nullable().optional(),
        attendeeEmail: z.string().nullable().optional(),
        startAt: z.string(),
        endAt: z.string(),
        notes: z.string().nullable().optional(),
        leadId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No active workspace");

    // Save to local DB first
    const { data: row, error } = await (supabase as any)
      .from("calendar_bookings")
      .insert({
        workspace_id: workspaceId,
        source: "manual",
        title: data.title,
        attendee_name: data.attendeeName ?? null,
        attendee_phone: data.attendeePhone ?? null,
        attendee_email: data.attendeeEmail || null,
        start_at: data.startAt,
        end_at: data.endAt,
        notes: data.notes ?? null,
        lead_id: data.leadId ?? null,
        status: "accepted",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const localId = row.id as string;

    // Attempt to push to Cal.com if configured and we have enough info
    const email = data.attendeeEmail?.trim() || null;
    const name = data.attendeeName?.trim() || "Guest";

    if (email) {
      try {
        const { data: settings } = await (supabase as any)
          .from("workspace_settings")
          .select("calcom_api_key, default_event_type_id, calcom_event_type_id, timezone")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        const apiKey: string | null = settings?.calcom_api_key ?? null;
        const eventTypeId: number =
          Number(settings?.default_event_type_id || settings?.calcom_event_type_id || 0) || 0;

        if (apiKey && eventTypeId) {
          let timezone: string | null = settings?.timezone ?? null;
          if (!timezone) timezone = await getCalcomUserTimezone(apiKey);
          timezone = timezone ?? "UTC";

          const booking = await createBooking(apiKey, {
            eventTypeId,
            start: data.startAt,
            name,
            email,
            phone: data.attendeePhone ?? undefined,
            notes: data.notes ?? undefined,
            timeZone: timezone,
          });

          // Link the local row to the new Cal.com booking
          await (supabase as any)
            .from("calendar_bookings")
            .update({
              external_id: booking.uid,
              meeting_url: booking.meetingUrl ?? null,
            })
            .eq("id", localId);
        }
      } catch (calErr) {
        // Cal.com push failed — log but don't fail the whole operation
        console.warn("[createManualBooking] Cal.com sync failed:", (calErr as Error).message);
      }
    }

    return { id: localId };
  });
