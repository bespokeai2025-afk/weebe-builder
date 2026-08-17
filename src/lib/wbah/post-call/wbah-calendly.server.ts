import { getWebespokeEnvVar } from "@/lib/integrations/webespokeEnterprise/webespoke-env.server";

export const WBAH_CALENDLY_EVENT_TYPE_ID =
  getWebespokeEnvVar("WBAH_CALENDLY_EVENT_TYPE_ID") ??
  process.env.WBAH_CALENDLY_EVENT_TYPE_ID ??
  "EBGJSBH4HVGLYFN6";

function calendlyToken(): string | null {
  return (
    getWebespokeEnvVar("WBAH_CALENDLY_API_TOKEN") ??
    getWebespokeEnvVar("CALENDLY_API_TOKEN") ??
    process.env.WBAH_CALENDLY_API_TOKEN?.trim() ??
    process.env.CALENDLY_API_TOKEN?.trim() ??
    null
  );
}

export function isWbahCalendlyConfigured(): boolean {
  return Boolean(calendlyToken());
}

export async function createWbahCalendlyBookingLink(): Promise<string | null> {
  const token = calendlyToken();
  if (!token) return null;

  const owner = `https://api.calendly.com/event_types/${WBAH_CALENDLY_EVENT_TYPE_ID}`;
  const res = await fetch("https://api.calendly.com/scheduling_links", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      max_event_count: 1,
      owner,
      owner_type: "EventType",
    }),
  });

  const json = (await res.json().catch(() => ({}))) as {
    resource?: { booking_url?: string };
    message?: string;
  };

  if (!res.ok) {
    throw new Error(
      `Calendly scheduling_links failed (${res.status}): ${json.message ?? JSON.stringify(json).slice(0, 200)}`,
    );
  }

  return json.resource?.booking_url?.trim() ?? null;
}

function randomDelayMs(): number {
  return (Math.floor(Math.random() * 20) + 5) * 1000;
}

export function wbahCalendlyRandomDelayMs(): number {
  return randomDelayMs();
}

// ─── Genuine Calendly availability (for Retell slot tool) ───────────────────

export interface CalendlyAvailableTime {
  status: string;
  invitees_remaining: number;
  start_time: string; // ISO 8601 UTC, e.g. "2026-08-17T09:00:00.000000Z"
}

/**
 * Fetch genuinely bookable start times from Calendly's event_type_available_times API.
 *
 * Both arguments must be ISO 8601 strings (UTC).  The Calendly API enforces a
 * ≤ 7-day window per request; callers must enforce this themselves if needed.
 *
 * Returns only slots whose status === "available".  Returns [] on any error so
 * the caller can degrade gracefully rather than throwing.
 */
export async function getWbahCalendlyAvailableTimes(
  startTimeIso: string,
  endTimeIso: string,
): Promise<CalendlyAvailableTime[]> {
  const token = calendlyToken();
  if (!token) {
    console.warn("[wbah-calendly] no token — cannot fetch available times");
    return [];
  }

  const eventTypeUri = `https://api.calendly.com/event_types/${WBAH_CALENDLY_EVENT_TYPE_ID}`;
  const params = new URLSearchParams({
    event_type: eventTypeUri,
    start_time: startTimeIso,
    end_time: endTimeIso,
  });

  const res = await fetch(
    `https://api.calendly.com/event_type_available_times?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(
      `[wbah-calendly] available_times ${res.status}:`,
      body.slice(0, 300),
    );
    return [];
  }

  const json = (await res.json()) as { collection?: CalendlyAvailableTime[] };
  return (json.collection ?? []).filter((s) => s.status === "available");
}

// ─── n8n invitee creation ────────────────────────────────────────────────────

/** n8n node 37 — POST /invitees with Q&A (batch 1 / 2s in n8n). */
export async function createWbahCalendlyInvitee(input: {
  email: string;
  name: string;
  startTimeUtc: string;
  phone?: string | null;
  propertyAddress?: string | null;
  salesforceUuid?: string | null;
}): Promise<void> {
  const token = calendlyToken();
  if (!token) return;

  await new Promise((r) => setTimeout(r, randomDelayMs()));

  const res = await fetch("https://api.calendly.com/invitees", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: `https://api.calendly.com/event_types/${WBAH_CALENDLY_EVENT_TYPE_ID}`,
      start_time: input.startTimeUtc,
      invitee: {
        name: input.name || "Customer",
        email: input.email || "no-reply@example.com",
        timezone: "Europe/London",
      },
      event_guests: ["enquiries@webuyanyhouse.co.uk"],
      questions_and_answers: [
        {
          position: 0,
          question: "Phone Number",
          answer: input.phone || "+444 444 4444",
        },
        {
          position: 1,
          question: "Property Address",
          answer: input.propertyAddress || "Address not provided",
        },
        {
          position: 2,
          question: "Name",
          answer: input.name || "Customer",
        },
      ],
      tracking: {
        utm_source: "api",
        utm_medium: "automation",
        utm_campaign: "default_campaign",
        utm_content: "default_content",
        utm_term: "default_term",
        salesforce_uuid: input.salesforceUuid || "N/A",
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[WBAH CALENDLY] invitees create failed (non-fatal)", res.status, body.slice(0, 300));
    throw new Error(`Calendly invitees failed (${res.status}): ${body.slice(0, 200)}`);
  }
}
