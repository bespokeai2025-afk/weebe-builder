import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "./crm-adapter.interface";

const HS_BASE = "https://api.hubapi.com";

export class HubSpotAdapter implements CrmAdapter {
  readonly name = "HubSpot";

  constructor(private readonly apiKey: string) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async checkResponse(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[HubSpot] ${label} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`HubSpot ${label} HTTP ${res.status}`);
    }
  }

  async upsertContact(contact: CrmContactInput): Promise<void> {
    const phone = contact.phone.replace(/\s/g, "");
    const nameParts = (contact.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const properties: Record<string, string> = { phone };
    if (firstName) properties.firstname = firstName;
    if (lastName) properties.lastname = lastName;
    if (contact.email) properties.email = contact.email;

    const searchRes = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }],
        properties: ["id", "phone"],
        limit: 1,
      }),
    });
    await this.checkResponse(searchRes, "contact search");
    const searchData = await searchRes.json();
    const existing = searchData?.results?.[0];

    if (existing?.id) {
      const patchRes = await fetch(`${HS_BASE}/crm/v3/objects/contacts/${existing.id}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify({ properties }),
      });
      await this.checkResponse(patchRes, "contact update");
    } else {
      const createRes = await fetch(`${HS_BASE}/crm/v3/objects/contacts`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ properties }),
      });
      await this.checkResponse(createRes, "contact create");
    }
  }

  async logCallActivity(activity: CrmCallActivityInput): Promise<void> {
    const phone = activity.phone.replace(/\s/g, "");
    const durationMs = (activity.durationSeconds ?? 0) * 1000;

    const searchRes = await fetch(`${HS_BASE}/crm/v3/objects/contacts/search`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: "phone", operator: "EQ", value: phone }] }],
        properties: ["id"],
        limit: 1,
      }),
    });
    await this.checkResponse(searchRes, "contact lookup for call");
    const searchData = await searchRes.json();
    const contactId: string | undefined = searchData?.results?.[0]?.id;

    const bodyText = [
      activity.summary ? `Summary: ${activity.summary}` : null,
      activity.durationSeconds != null ? `Duration: ${activity.durationSeconds}s` : null,
      activity.sentiment ? `Sentiment: ${activity.sentiment}` : null,
      activity.agentName ? `Agent: ${activity.agentName}` : null,
      `Call ID: ${activity.callId}`,
    ]
      .filter(Boolean)
      .join("\n");

    const callBody: Record<string, unknown> = {
      properties: {
        hs_call_title: `Voice Agent Call — ${activity.agentName ?? "Agent"}`,
        hs_call_body: bodyText,
        hs_call_duration: durationMs,
        hs_call_status: "COMPLETED",
        hs_timestamp: activity.calledAt ?? new Date().toISOString(),
        hs_call_direction: "INBOUND",
      },
    };

    if (contactId) {
      callBody.associations = [
        {
          to: { id: contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 194 }],
        },
      ];
    }

    const callRes = await fetch(`${HS_BASE}/crm/v3/objects/calls`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(callBody),
    });
    await this.checkResponse(callRes, "call activity create");
  }
}

export async function validateHubSpotKey(apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${HS_BASE}/crm/v3/objects/contacts?limit=1`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
