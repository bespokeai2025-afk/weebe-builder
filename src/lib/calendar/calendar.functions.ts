import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { listCalendars, listEventTypes } from "./calcom.server";

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export interface WorkspaceCalendarSettingsRow {
  workspace_id: string;
  calcom_api_key: string | null;
  default_event_type_id: number | null;
  timezone: string;
  buffer_minutes: number;
  min_notice_hours: number;
  working_hours: JsonValue;
  last_synced_at: string | null;
  updated_at: string;
}

/** Get the current workspace's calendar settings (or null if none). */
export const getWorkspaceCalendarSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await supabase
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data as WorkspaceCalendarSettingsRow | null;
  });

/** Upsert workspace calendar settings. */
export const saveWorkspaceCalendarSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      calcomApiKey?: string | null;
      defaultEventTypeId?: number | null;
      timezone?: string;
      bufferMinutes?: number;
      minNoticeHours?: number;
      workingHours?: unknown;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const patch: Record<string, unknown> = { workspace_id: workspaceId };
    if (data.calcomApiKey !== undefined) patch.calcom_api_key = data.calcomApiKey;
    if (data.defaultEventTypeId !== undefined)
      patch.default_event_type_id = data.defaultEventTypeId;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.bufferMinutes !== undefined) patch.buffer_minutes = data.bufferMinutes;
    if (data.minNoticeHours !== undefined) patch.min_notice_hours = data.minNoticeHours;
    if (data.workingHours !== undefined) patch.working_hours = data.workingHours;

    const { error } = await supabase
      .from("workspace_settings")
      .upsert(patch as never, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Pull calendars + event types from Cal.com using the saved workspace key
 * and upsert them into our tables.
 */
export const syncCalcomConnections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: settings, error: sErr } = await supabase
      .from("workspace_settings")
      .select("calcom_api_key")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    const apiKey = settings?.calcom_api_key;
    if (!apiKey) throw new Error("No Cal.com API key configured for this workspace.");

    const [calendars, eventTypes] = await Promise.all([
      listCalendars(apiKey),
      listEventTypes(apiKey),
    ]);

    const now = new Date().toISOString();

    if (calendars.length > 0) {
      const rows = calendars.map((c) => ({
        user_id: context.userId,
        provider: c.integration?.includes("office365") ? "outlook" : "google",
        calcom_credential_id: c.credentialId ?? null,
        external_id: c.externalId,
        email: c.email ?? null,
        name: c.name,
        read_only: Boolean(c.readOnly),
        last_synced_at: now,
      }));
      const { error } = await supabase
        .from("calendar_connections")
        .upsert(rows, { onConflict: "user_id,provider,external_id", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
    }

    if (eventTypes.length > 0) {
      const rows = eventTypes.map((e) => ({
        user_id: context.userId,
        calcom_event_type_id: e.id,
        title: e.title,
        slug: e.slug ?? null,
        length_minutes: e.length ?? 30,
        last_synced_at: now,
      }));
      const { error } = await supabase
        .from("calcom_event_types")
        .upsert(rows, { onConflict: "user_id,calcom_event_type_id", ignoreDuplicates: false });
      if (error) throw new Error(error.message);
    }

    // Auto-pick a default event type if the user hasn't set one yet so
    // booking tools deploy correctly without manual config.
    const settingsPatch: Record<string, unknown> = { last_synced_at: now };
    const { data: existing } = await supabase
      .from("workspace_settings")
      .select("default_event_type_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!existing?.default_event_type_id && eventTypes.length > 0) {
      settingsPatch.default_event_type_id = eventTypes[0].id;
    }
    await supabase
      .from("workspace_settings")
      .update(settingsPatch as never)
      .eq("workspace_id", workspaceId);

    return { calendars: calendars.length, eventTypes: eventTypes.length };
  });

export const listCalendarConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("calendar_connections")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listCalcomEventTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("calcom_event_types")
      .select("*")
      .order("title", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const setCalendarFlags = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { id: string; isAvailability?: boolean; isPrimaryBooking?: boolean }) => input,
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    // Only one primary at a time: clear other primaries first.
    if (data.isPrimaryBooking === true) {
      await supabase
        .from("calendar_connections")
        .update({ is_primary_booking: false })
        .eq("user_id", userId);
    }

    const patch: Record<string, unknown> = {};
    if (data.isAvailability !== undefined) patch.is_availability = data.isAvailability;
    if (data.isPrimaryBooking !== undefined) patch.is_primary_booking = data.isPrimaryBooking;

    const { error } = await supabase
      .from("calendar_connections")
      .update(patch as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setEventTypeActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => input)
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("calcom_event_types")
      .update({ active: data.active })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listMyBookings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("bookings")
      .select("*")
      .order("start_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return data ?? [];
  });
