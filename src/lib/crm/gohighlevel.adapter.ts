import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "./crm-adapter.interface";

const GHL_BASE = "https://services.leadconnectorhq.com";

export class GoHighLevelAdapter implements CrmAdapter {
  readonly name = "GoHighLevel";

  constructor(
    private readonly apiKey: string,
    private readonly locationId: string,
  ) {}

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      Version: "2021-07-28",
    };
  }

  private async checkResponse(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[GoHighLevel] ${label} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`GoHighLevel ${label} HTTP ${res.status}`);
    }
  }

  async upsertContact(contact: CrmContactInput): Promise<void> {
    const phone = contact.phone.replace(/\s/g, "");
    const nameParts = (contact.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || undefined;

    const searchRes = await fetch(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${this.locationId}&phone=${encodeURIComponent(phone)}`,
      { headers: this.headers() },
    );
    await this.checkResponse(searchRes, "contact search");
    const searchData = await searchRes.json();
    const existing = searchData?.contact;

    const payload: Record<string, string> = {
      locationId: this.locationId,
      phone,
    };
    if (firstName) payload.firstName = firstName;
    if (lastName) payload.lastName = lastName;
    if (contact.email) payload.email = contact.email;

    if (existing?.id) {
      const updateRes = await fetch(`${GHL_BASE}/contacts/${existing.id}`, {
        method: "PUT",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      await this.checkResponse(updateRes, "contact update");
    } else {
      const createRes = await fetch(`${GHL_BASE}/contacts/`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      await this.checkResponse(createRes, "contact create");
    }
  }

  async logCallActivity(activity: CrmCallActivityInput): Promise<void> {
    const phone = activity.phone.replace(/\s/g, "");

    const searchRes = await fetch(
      `${GHL_BASE}/contacts/search/duplicate?locationId=${this.locationId}&phone=${encodeURIComponent(phone)}`,
      { headers: this.headers() },
    );
    await this.checkResponse(searchRes, "contact lookup for note");
    const searchData = await searchRes.json();
    const contactId: string | undefined = searchData?.contact?.id;
    if (!contactId) {
      console.warn("[GoHighLevel] logCallActivity skipped — no contact found for phone", phone);
      return;
    }

    const body = [
      activity.summary ? `Summary: ${activity.summary}` : null,
      activity.durationSeconds != null ? `Duration: ${activity.durationSeconds}s` : null,
      activity.sentiment ? `Sentiment: ${activity.sentiment}` : null,
      activity.agentName ? `Agent: ${activity.agentName}` : null,
      `Call ID: ${activity.callId}`,
    ]
      .filter(Boolean)
      .join("\n");

    const noteRes = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ body }),
    });
    await this.checkResponse(noteRes, "call note create");
  }

  async healthCheck(): Promise<boolean> {
    return validateGhlKey(this.apiKey, this.locationId);
  }
}

export async function validateGhlKey(apiKey: string, locationId: string): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE}/contacts/?locationId=${locationId}&limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}
