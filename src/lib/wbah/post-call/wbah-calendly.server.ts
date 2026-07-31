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

/** Optional: create invitee when email + slot are known (best-effort). */
export async function createWbahCalendlyInvitee(input: {
  eventUri: string;
  email: string;
  name: string;
  startTimeUtc: string;
}): Promise<void> {
  const token = calendlyToken();
  if (!token) return;

  const res = await fetch("https://api.calendly.com/scheduled_events", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: `https://api.calendly.com/event_types/${WBAH_CALENDLY_EVENT_TYPE_ID}`,
      start_time: input.startTimeUtc,
      invitees: [{ email: input.email, name: input.name }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.warn("[WBAH CALENDLY] invitee create failed (non-fatal)", res.status, body.slice(0, 200));
  }
}
