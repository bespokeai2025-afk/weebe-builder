/**
 * Cal.com v2 REST helper. Server-only.
 *
 * Cal.com API key auth uses ?apiKey=... on every request.
 * Docs: https://cal.com/docs/api-reference
 */

const CAL_BASE = "https://api.cal.com/v2";

export interface CalcomEventType {
  id: number;
  title: string;
  slug: string;
  length: number;
}

export interface CalcomCalendarEntry {
  externalId: string;
  name: string;
  email?: string;
  primary?: boolean;
  readOnly?: boolean;
  credentialId?: number;
  integration?: string;
}

export interface CalcomSlot {
  time: string; // ISO start
}

export async function calFetch<T = unknown>(
  apiKey: string,
  path: string,
  init?: {
    method?: string;
    body?: unknown;
    query?: Record<string, string | number | undefined>;
    apiVersion?: string;
  },
): Promise<T> {
  const url = new URL(`${CAL_BASE}${path}`);
  if (init?.query) {
    for (const [k, v] of Object.entries(init.query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (init?.apiVersion) headers["cal-api-version"] = init.apiVersion;
  const res = await fetch(url.toString(), {
    method: init?.method ?? "GET",
    headers,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed && "message" in parsed
        ? String((parsed as { message: unknown }).message)
        : text || res.statusText;
    throw new Error(`Cal.com ${path} ${res.status}: ${msg}`);
  }
  // v2 wraps in { status, data }
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

export async function listEventTypes(apiKey: string): Promise<CalcomEventType[]> {
  const data = await calFetch<
    { eventTypeGroups?: Array<{ eventTypes: CalcomEventType[] }> } | CalcomEventType[]
  >(apiKey, "/event-types");
  if (Array.isArray(data)) return data;
  const groups =
    (data as { eventTypeGroups?: Array<{ eventTypes: CalcomEventType[] }> }).eventTypeGroups ?? [];
  return groups.flatMap((g) => g.eventTypes ?? []);
}

export async function listCalendars(apiKey: string): Promise<CalcomCalendarEntry[]> {
  // v2 endpoint: GET /calendars -> { connectedCalendars: [{ calendars: [...] }], ... }
  const data = await calFetch<{
    connectedCalendars?: Array<{
      integration?: { slug?: string };
      credentialId?: number;
      calendars?: Array<{
        externalId: string;
        name: string;
        email?: string;
        primary?: boolean;
        readOnly?: boolean;
      }>;
    }>;
  }>(apiKey, "/calendars");
  const out: CalcomCalendarEntry[] = [];
  for (const conn of data.connectedCalendars ?? []) {
    for (const cal of conn.calendars ?? []) {
      out.push({
        externalId: cal.externalId,
        name: cal.name,
        email: cal.email,
        primary: cal.primary,
        readOnly: cal.readOnly,
        credentialId: conn.credentialId,
        integration: conn.integration?.slug ?? "google_calendar",
      });
    }
  }
  return out;
}

export async function getAvailableSlots(
  apiKey: string,
  params: { eventTypeId: number; startTime: string; endTime: string; timeZone?: string },
): Promise<CalcomSlot[]> {
  const data = await calFetch<{ slots?: Record<string, Array<{ time: string }>> }>(
    apiKey,
    "/slots/available",
    {
      query: {
        eventTypeId: params.eventTypeId,
        startTime: params.startTime,
        endTime: params.endTime,
        timeZone: params.timeZone,
      },
    },
  );
  const slots: CalcomSlot[] = [];
  for (const day of Object.values(data.slots ?? {})) {
    for (const s of day) slots.push({ time: s.time });
  }
  return slots;
}

export interface CalcomBookingResult {
  id: number;
  uid: string;
  startTime: string;
  endTime: string;
  meetingUrl?: string;
}

export async function createBooking(
  apiKey: string,
  body: {
    eventTypeId: number;
    start: string;
    name: string;
    email: string;
    phone?: string;
    timeZone: string;
    notes?: string;
    language?: string;
  },
): Promise<CalcomBookingResult> {
  const data = await calFetch<Record<string, unknown>>(apiKey, "/bookings", {
    method: "POST",
    apiVersion: "2024-08-13",
    body: {
      eventTypeId: body.eventTypeId,
      start: body.start,
      attendee: {
        name: body.name,
        email: body.email,
        timeZone: body.timeZone,
        language: body.language ?? "en",
        ...(body.phone ? { phoneNumber: body.phone } : {}),
      },
      ...(body.notes ? { bookingFieldsResponses: { notes: body.notes } } : {}),
      metadata: {},
    },
  });
  return normalizeBooking(data);
}

function normalizeBooking(d: Record<string, unknown>): CalcomBookingResult {
  const meetingUrl =
    (d.meetingUrl as string | undefined) ??
    (d.videoCallData as { url?: string } | undefined)?.url ??
    ((d.references as Array<{ meetingUrl?: string }> | undefined) ?? []).find((r) => r.meetingUrl)
      ?.meetingUrl ??
    undefined;
  return {
    id: Number(d.id ?? 0),
    uid: String(d.uid ?? ""),
    startTime: String(d.start ?? d.startTime ?? ""),
    endTime: String(d.end ?? d.endTime ?? ""),
    meetingUrl,
  };
}

/**
 * Fetch the Cal.com account owner's timezone from their profile.
 * Returns null if the API call fails or no timezone is set.
 */
export async function getCalcomUserTimezone(apiKey: string): Promise<string | null> {
  try {
    const data = await calFetch<{ timeZone?: string; timezone?: string }>(apiKey, "/me");
    const tz = data?.timeZone ?? data?.timezone ?? null;
    return tz && tz.length > 0 ? tz : null;
  } catch {
    return null;
  }
}

export async function cancelBooking(
  apiKey: string,
  bookingUid: string,
  reason?: string,
): Promise<void> {
  await calFetch(apiKey, `/bookings/${bookingUid}/cancel`, {
    method: "POST",
    body: { cancellationReason: reason ?? "Cancelled via voice agent" },
  });
}

export async function rescheduleBooking(
  apiKey: string,
  bookingUid: string,
  newStart: string,
  reason?: string,
): Promise<CalcomBookingResult> {
  const data = await calFetch<Record<string, unknown>>(
    apiKey,
    `/bookings/${bookingUid}/reschedule`,
    {
      method: "POST",
      apiVersion: "2024-08-13",
      body: {
        start: newStart,
        reschedulingReason: reason ?? "Rescheduled via voice agent",
      },
    },
  );
  return normalizeBooking(data);
}
