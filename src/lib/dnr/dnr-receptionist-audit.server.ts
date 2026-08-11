/**
 * Persist DNR / Pabau receptionist tool outcomes for WEBEE dashboard visibility.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DNR_VOICE } from "@/lib/dnr/dnr-voice.config";

function parseRetellCallId(rawBody: string): string | undefined {
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    const call = (parsed.call ?? {}) as Record<string, unknown>;
    const id = call.call_id ?? parsed.call_id;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

function summarizeForLog(value: unknown, max = 1200): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v == null) continue;
    if (typeof v === "string") out[k] = v.length > 200 ? `${v.slice(0, 200)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (typeof v === "object") out[k] = "[object]";
  }
  const json = JSON.stringify(out);
  if (json.length <= max) return out;
  return { truncated: true, preview: json.slice(0, max) };
}

export async function logReceptionistToolEvent(input: {
  workspaceId: string;
  toolName: string;
  rawBody: string;
  requestArgs: Record<string, unknown>;
  responseStatus: number;
  responseBody: unknown;
}): Promise<void> {
  try {
    let ok = input.responseStatus >= 200 && input.responseStatus < 300;
    if (responseBodyIndicatesFailure(input.responseBody)) ok = false;

    await supabaseAdmin.from("receptionist_tool_events" as never).insert({
      workspace_id: input.workspaceId,
      retell_call_id: parseRetellCallId(input.rawBody) ?? null,
      tool_name: input.toolName,
      ok,
      request_summary: summarizeForLog(input.requestArgs),
      response_summary: summarizeForLog(
        typeof input.responseBody === "object" && input.responseBody
          ? (input.responseBody as Record<string, unknown>)
          : { message: String(input.responseBody ?? "") },
      ),
    } as never);
  } catch (e) {
    console.warn("[dnr-audit] tool event log failed (non-fatal)", e);
  }
}

function responseBodyIndicatesFailure(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const o = body as Record<string, unknown>;
  if (o.ok === false) return true;
  if (typeof o.error === "string" && o.error.trim()) return true;
  return false;
}

function cheshireStartIso(startDate: string, startTime: string): string {
  const t = startTime.length === 5 ? `${startTime}:00` : startTime;
  return `${startDate}T${t}`;
}

function addMinutesIso(isoLocal: string, minutes: number): string {
  const d = new Date(isoLocal);
  if (Number.isNaN(d.getTime())) {
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }
  return new Date(d.getTime() + minutes * 60_000).toISOString();
}

export async function persistPabauBookingToCalendar(input: {
  workspaceId: string;
  contactId: string | number;
  serviceName: string;
  startDate: string;
  startTime: string;
  notes?: string;
  durationMinutes?: number;
  attendeePhone?: string;
  attendeeName?: string;
  pabauRaw?: unknown;
}): Promise<void> {
  try {
    const startAt = cheshireStartIso(input.startDate, input.startTime);
    const duration = input.durationMinutes && input.durationMinutes > 0 ? input.durationMinutes : 30;
    const endAt = addMinutesIso(startAt, duration);
    const externalId = `pabau:${input.contactId}:${input.startDate}:${input.startTime}:${input.serviceName}`;

    const { data: existing } = await supabaseAdmin
      .from("calendar_bookings")
      .select("id")
      .eq("workspace_id", input.workspaceId)
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing?.id) return;

    const { error } = await supabaseAdmin.from("calendar_bookings").insert({
      workspace_id: input.workspaceId,
      external_id: externalId,
      source: "pabau",
      title: `${input.serviceName} · ${DNR_VOICE.location.name}`,
      description: input.notes ?? "Booked via AI receptionist (Pabau)",
      start_at: startAt,
      end_at: endAt,
      attendee_name: input.attendeeName ?? null,
      attendee_phone: input.attendeePhone ?? null,
      status: "accepted",
      notes: `Pabau contact_id=${input.contactId}`,
    } as never);

    if (error) {
      console.warn("[dnr-audit] calendar_bookings insert failed", error.message);
    }
  } catch (e) {
    console.warn("[dnr-audit] persistPabauBooking failed (non-fatal)", e);
  }
}
