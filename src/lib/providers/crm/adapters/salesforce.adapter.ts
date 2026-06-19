import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "@/lib/crm/crm-adapter.interface";

const API_VERSION = "v59.0";

export class SalesforceAdapter implements CrmAdapter {
  readonly name = "Salesforce";

  constructor(private readonly _config: { instanceUrl: string; accessToken: string }) {}

  private get base() {
    return `${this._config.instanceUrl}/services/data/${API_VERSION}`;
  }

  private headers() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this._config.accessToken}`,
    };
  }

  private async checkResponse(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Salesforce] ${label} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`Salesforce ${label} HTTP ${res.status}`);
    }
  }

  async upsertContact(contact: CrmContactInput): Promise<void> {
    const phone = contact.phone.replace(/\s/g, "");
    const nameParts = (contact.name ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] ?? "";
    const lastName = nameParts.slice(1).join(" ") || "Unknown";

    const soql = `SELECT Id FROM Contact WHERE Phone='${phone}' LIMIT 1`;
    const searchRes = await fetch(
      `${this.base}/query?q=${encodeURIComponent(soql)}`,
      { headers: this.headers() },
    );
    await this.checkResponse(searchRes, "contact search");
    const searchData = await searchRes.json();
    const existing = searchData?.records?.[0];

    const payload: Record<string, string> = { Phone: phone, LastName: lastName };
    if (firstName) payload.FirstName = firstName;
    if (contact.email) payload.Email = contact.email;

    if (existing?.Id) {
      const patchRes = await fetch(`${this.base}/sobjects/Contact/${existing.Id}`, {
        method: "PATCH",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      if (patchRes.status !== 204) await this.checkResponse(patchRes, "contact update");
    } else {
      const createRes = await fetch(`${this.base}/sobjects/Contact`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      await this.checkResponse(createRes, "contact create");
    }
  }

  async logCallActivity(activity: CrmCallActivityInput): Promise<void> {
    const phone = activity.phone.replace(/\s/g, "");

    const soql = `SELECT Id FROM Contact WHERE Phone='${phone}' LIMIT 1`;
    const searchRes = await fetch(
      `${this.base}/query?q=${encodeURIComponent(soql)}`,
      { headers: this.headers() },
    );
    await this.checkResponse(searchRes, "contact lookup for task");
    const searchData = await searchRes.json();
    const contactId: string | undefined = searchData?.records?.[0]?.Id;

    const description = [
      activity.summary ? `Summary: ${activity.summary}` : null,
      activity.durationSeconds != null ? `Duration: ${activity.durationSeconds}s` : null,
      activity.sentiment ? `Sentiment: ${activity.sentiment}` : null,
      activity.agentName ? `Agent: ${activity.agentName}` : null,
      `Call ID: ${activity.callId}`,
    ]
      .filter(Boolean)
      .join("\n");

    const task: Record<string, unknown> = {
      Subject: `Voice Agent Call — ${activity.agentName ?? "Agent"}`,
      Description: description,
      Status: "Completed",
      ActivityDate: (activity.calledAt ?? new Date().toISOString()).slice(0, 10),
      CallDurationInSeconds: activity.durationSeconds ?? 0,
      CallType: "Inbound",
      TaskSubtype: "Call",
    };
    if (contactId) task.WhoId = contactId;

    const taskRes = await fetch(`${this.base}/sobjects/Task`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(task),
    });
    await this.checkResponse(taskRes, "task create");
  }

  async healthCheck(): Promise<boolean> {
    const { instanceUrl, accessToken } = this._config;
    if (!instanceUrl || !accessToken) return false;
    try {
      const resp = await fetch(`${instanceUrl}/services/data/${API_VERSION}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return resp.ok;
    } catch { return false; }
  }
}
