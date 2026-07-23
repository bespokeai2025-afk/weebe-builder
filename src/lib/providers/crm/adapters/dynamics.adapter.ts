import type { CrmAdapter, CrmCallActivityInput, CrmContactInput } from "@/lib/crm/crm-adapter.interface";

export type DynamicsAdapterConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Dataverse org URL, e.g. https://yourorg.crm.dynamics.com */
  orgUrl: string;
};

function normalizeOrgUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

export async function fetchDynamicsAccessToken(cfg: DynamicsAdapterConfig): Promise<string> {
  const tenantId = cfg.tenantId.trim();
  const clientId = cfg.clientId.trim();
  const clientSecret = cfg.clientSecret.trim();
  const orgUrl = normalizeOrgUrl(cfg.orgUrl);
  if (!tenantId || !clientId || !clientSecret || !orgUrl) {
    throw new Error("Dynamics credentials incomplete — need Tenant ID, Client ID, Client Secret, and Organization URL.");
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: `${orgUrl}/.default`,
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`;
    throw new Error(`Dynamics OAuth failed: ${detail}`);
  }
  return json.access_token;
}

export class DynamicsAdapter implements CrmAdapter {
  readonly name = "Microsoft Dynamics";

  constructor(private readonly cfg: DynamicsAdapterConfig) {}

  private orgUrl(): string {
    return normalizeOrgUrl(this.cfg.orgUrl);
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await fetchDynamicsAccessToken(this.cfg);
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };
  }

  async upsertContact(_contact: CrmContactInput): Promise<void> {
    throw new Error("Dynamics lead upsert is not wired in this workspace yet — connection test only.");
  }

  async logCallActivity(_activity: CrmCallActivityInput): Promise<void> {
    throw new Error("Dynamics call logging is not wired in this workspace yet — connection test only.");
  }

  async healthCheck(): Promise<boolean> {
    try {
      const headers = await this.authHeaders();
      const res = await fetch(`${this.orgUrl()}/api/data/v9.2/WhoAmI`, { headers });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.error("[Dynamics] WhoAmI failed", res.status, body.slice(0, 300));
        return false;
      }
      const json = (await res.json()) as { UserId?: string };
      return !!json.UserId;
    } catch (e) {
      console.error("[Dynamics] healthCheck error", (e as Error).message);
      return false;
    }
  }
}

export function dynamicsConfigFromStored(stored: Record<string, string>): DynamicsAdapterConfig | null {
  const tenantId = String(stored.tenantId ?? stored.tenant_id ?? "").trim();
  const clientId = String(stored.clientId ?? stored.client_id ?? "").trim();
  const clientSecret = String(stored.clientSecret ?? stored.client_secret ?? "").trim();
  const orgUrl = String(
    stored.orgUrl ?? stored.org_url ?? stored.environmentUrl ?? stored.environment_url ?? "",
  ).trim();
  if (!tenantId || !clientId || !clientSecret || !orgUrl) return null;
  return { tenantId, clientId, clientSecret, orgUrl };
}
