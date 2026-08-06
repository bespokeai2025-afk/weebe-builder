import {
  fetchDynamicsAccessToken,
  type DynamicsAdapterConfig,
} from "@/lib/providers/crm/adapters/dynamics.adapter";
import { getWebespokeEnvVar } from "@/lib/integrations/webespokeEnterprise/webespoke-env.server";

export function getWbahDynamicsConfig(): DynamicsAdapterConfig | null {
  const tenantId =
    getWebespokeEnvVar("DYNAMICS_TENANT_ID") ?? process.env.DYNAMICS_TENANT_ID?.trim();
  const clientId =
    getWebespokeEnvVar("DYNAMICS_CLIENT_ID") ?? process.env.DYNAMICS_CLIENT_ID?.trim();
  const clientSecret =
    getWebespokeEnvVar("DYNAMICS_CLIENT_SECRET") ?? process.env.DYNAMICS_CLIENT_SECRET?.trim();

  let orgUrl =
    getWebespokeEnvVar("DYNAMICS_ORG_URL") ??
    process.env.DYNAMICS_ORG_URL?.trim() ??
    "";

  if (!orgUrl) {
    const resource =
      getWebespokeEnvVar("DYNAMICS_RESOURCE") ?? process.env.DYNAMICS_RESOURCE?.trim() ?? "";
    orgUrl = resource.replace(/\/\.default$/i, "");
  }
  if (!orgUrl) {
    const base =
      getWebespokeEnvVar("DYNAMICS_BASE_URL") ?? process.env.DYNAMICS_BASE_URL?.trim() ?? "";
    orgUrl = base.replace(/\/api\/data\/v[\d.]+$/i, "");
  }

  if (!tenantId || !clientId || !clientSecret || !orgUrl) return null;
  return { tenantId, clientId, clientSecret, orgUrl };
}

async function dynamicsHeaders(cfg: DynamicsAdapterConfig): Promise<Record<string, string>> {
  const token = await fetchDynamicsAccessToken(cfg);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    Prefer: 'return=representation',
  };
}

function apiBase(cfg: DynamicsAdapterConfig): string {
  return `${cfg.orgUrl.replace(/\/+$/, "")}/api/data/v9.2`;
}

export async function getWbahLeadCurrentStatus(
  leadId: string,
): Promise<{
  new_currentstatus: number | null;
  statecode: number | null;
  raw: Record<string, unknown>;
} | null> {
  const cfg = getWbahDynamicsConfig();
  if (!cfg) throw new Error("Dynamics credentials not configured");

  const headers = await dynamicsHeaders(cfg);
  const url = `${apiBase(cfg)}/leads(${leadId})?$select=leadid,new_currentstatus,statecode,statuscode`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dynamics GET lead failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as Record<string, unknown>;
  const status = json.new_currentstatus;
  const statecode = json.statecode;
  return {
    new_currentstatus: typeof status === "number" ? status : status != null ? Number(status) : null,
    statecode: typeof statecode === "number" ? statecode : statecode != null ? Number(statecode) : null,
    raw: json,
  };
}

export async function patchWbahLead(
  leadId: string,
  fields: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (!Object.keys(fields).length) return;

  const cfg = getWbahDynamicsConfig();
  if (!cfg) throw new Error("Dynamics credentials not configured");

  const headers = await dynamicsHeaders(cfg);
  const url = `${apiBase(cfg)}/leads(${leadId})`;
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dynamics PATCH lead failed (${res.status}): ${body.slice(0, 400)}`);
  }
}

export async function patchWbahOpportunity(
  opportunityId: string,
  fields: Record<string, string | number | boolean | null>,
): Promise<void> {
  if (!Object.keys(fields).length) return;

  const cfg = getWbahDynamicsConfig();
  if (!cfg) throw new Error("Dynamics credentials not configured");

  const headers = await dynamicsHeaders(cfg);
  const url = `${apiBase(cfg)}/opportunities(${opportunityId})`;
  const res = await fetch(url, {
    method: "PATCH",
    headers,
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Dynamics PATCH opportunity failed (${res.status}): ${body.slice(0, 400)}`);
  }
  console.log("[DynamicsOpportunity] Synced opportunity", {
    opportunityId,
    fields: Object.keys(fields),
  });
}

/** Post timeline note bound to Opportunity (objectid_opportunity). */
export async function postWbahOpportunityTimelineNote(input: {
  opportunityId: string;
  subject: string;
  noteText: string;
}): Promise<void> {
  const cfg = getWbahDynamicsConfig();
  if (!cfg) throw new Error("Dynamics credentials not configured");

  const headers = await dynamicsHeaders(cfg);
  const url = `${apiBase(cfg)}/annotations`;
  const body = {
    subject: input.subject.slice(0, 200),
    notetext: input.noteText.slice(0, 100_000),
    "objectid_opportunity@odata.bind": `/opportunities(${input.opportunityId})`,
  };
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Dynamics opportunity note failed (${res.status}): ${text.slice(0, 400)}`);
  }
  console.log("[DynamicsNote] Posted call summary for opportunity", {
    opportunityId: input.opportunityId,
  });
}

export function isWbahDynamicsConfigured(): boolean {
  return getWbahDynamicsConfig() != null;
}
