import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "@/lib/crm/crm-adapter.interface";

const PD_BASE = "https://api.pipedrive.com/v1";

export class PipedriveAdapter implements CrmAdapter {
  readonly name = "Pipedrive";

  constructor(private readonly _apiToken: string) {}

  private url(path: string) {
    return `${PD_BASE}${path}?api_token=${this._apiToken}`;
  }

  private async checkResponse(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Pipedrive] ${label} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`Pipedrive ${label} HTTP ${res.status}`);
    }
  }

  async upsertContact(contact: CrmContactInput): Promise<void> {
    const phone = contact.phone.replace(/\s/g, "");

    const searchRes = await fetch(
      `${PD_BASE}/persons/search?term=${encodeURIComponent(phone)}&fields=phone&api_token=${this._apiToken}`,
    );
    await this.checkResponse(searchRes, "person search");
    const searchData = await searchRes.json();
    const existing = searchData?.data?.items?.[0]?.item;

    const payload: Record<string, unknown> = {
      name: contact.name ?? phone,
      phone: [{ value: phone, primary: true }],
    };
    if (contact.email) payload.email = [{ value: contact.email, primary: true }];

    if (existing?.id) {
      const updateRes = await fetch(this.url(`/persons/${existing.id}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await this.checkResponse(updateRes, "person update");
    } else {
      const createRes = await fetch(this.url("/persons"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await this.checkResponse(createRes, "person create");
    }
  }

  async logCallActivity(activity: CrmCallActivityInput): Promise<void> {
    const phone = activity.phone.replace(/\s/g, "");

    const searchRes = await fetch(
      `${PD_BASE}/persons/search?term=${encodeURIComponent(phone)}&fields=phone&api_token=${this._apiToken}`,
    );
    await this.checkResponse(searchRes, "person lookup for activity");
    const searchData = await searchRes.json();
    const personId: number | undefined = searchData?.data?.items?.[0]?.item?.id;

    const note = [
      activity.summary ? `Summary: ${activity.summary}` : null,
      activity.durationSeconds != null ? `Duration: ${activity.durationSeconds}s` : null,
      activity.sentiment ? `Sentiment: ${activity.sentiment}` : null,
      activity.agentName ? `Agent: ${activity.agentName}` : null,
      `Call ID: ${activity.callId}`,
    ]
      .filter(Boolean)
      .join("<br>");

    const activityPayload: Record<string, unknown> = {
      subject: `Voice Agent Call — ${activity.agentName ?? "Agent"}`,
      type: "call",
      done: 1,
      duration: activity.durationSeconds != null
        ? `00:${String(Math.floor(activity.durationSeconds / 60)).padStart(2, "0")}:${String(activity.durationSeconds % 60).padStart(2, "0")}`
        : "00:00:00",
      note,
    };
    if (activity.calledAt) activityPayload.due_date = activity.calledAt.slice(0, 10);
    if (personId) activityPayload.person_id = personId;

    const actRes = await fetch(this.url("/activities"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activityPayload),
    });
    await this.checkResponse(actRes, "activity create");
  }

  async healthCheck(): Promise<boolean> {
    if (!this._apiToken) return false;
    try {
      const resp = await fetch(`${PD_BASE}/users/me?api_token=${this._apiToken}`);
      return resp.ok;
    } catch { return false; }
  }
}
