import type { CrmAdapter, CrmContactInput, CrmCallActivityInput } from "./crm-adapter.interface";

export class WeeBespokeAiAdapter implements CrmAdapter {
  readonly name = "WeeBespokeAI";

  constructor(
    private readonly apiKey: string,
    private readonly apiUrl: string,
  ) {}

  private base(): string {
    return this.apiUrl.replace(/\/$/, "");
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  private async checkResponse(res: Response, label: string): Promise<void> {
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[WeeBespokeAI] ${label} failed — HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new Error(`WeeBespokeAI ${label} HTTP ${res.status}`);
    }
  }

  async upsertContact(contact: CrmContactInput): Promise<void> {
    const res = await fetch(`${this.base()}/api/crm/contacts`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        phone:  contact.phone,
        name:   contact.name  ?? undefined,
        email:  contact.email ?? undefined,
      }),
    });
    await this.checkResponse(res, "upsertContact");
  }

  async logCallActivity(activity: CrmCallActivityInput): Promise<void> {
    const res = await fetch(`${this.base()}/api/crm/calls`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        phone:            activity.phone,
        contact_name:     activity.contactName  ?? undefined,
        agent_name:       activity.agentName    ?? undefined,
        summary:          activity.summary      ?? undefined,
        duration_seconds: activity.durationSeconds ?? undefined,
        sentiment:        activity.sentiment    ?? undefined,
        call_id:          activity.callId,
        called_at:        activity.calledAt     ?? new Date().toISOString(),
      }),
    });
    await this.checkResponse(res, "logCallActivity");
  }

  async healthCheck(): Promise<boolean> {
    return validateWeeBespokeAiKey(this.apiKey, this.apiUrl);
  }
}

export async function validateWeeBespokeAiKey(apiKey: string, apiUrl: string): Promise<boolean> {
  try {
    const base = apiUrl.replace(/\/$/, "");
    const res = await fetch(`${base}/api/crm/health`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
