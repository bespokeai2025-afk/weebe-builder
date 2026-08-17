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
