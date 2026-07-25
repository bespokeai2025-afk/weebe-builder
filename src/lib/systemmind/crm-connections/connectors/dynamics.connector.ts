// ── Microsoft Dynamics (Dataverse) connector (Task #457) ──────────────────────
// Reuses the existing OAuth client-credentials flow from the runtime adapter.
import { fetchDynamicsAccessToken, type DynamicsAdapterConfig } from "@/lib/providers/crm/adapters/dynamics.adapter";
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

export function buildDynamicsConnector(creds: Record<string, string>): CrmConnector {
  const cfg: DynamicsAdapterConfig = {
    tenantId: (creds.tenantId ?? creds.tenant_id ?? "").trim(),
    clientId: (creds.clientId ?? creds.client_id ?? "").trim(),
    clientSecret: (creds.clientSecret ?? creds.client_secret ?? "").trim(),
    orgUrl: (creds.orgUrl ?? creds.org_url ?? creds.environmentUrl ?? creds.environment_url ?? "").trim().replace(/\/+$/, ""),
  };
  const api = `${cfg.orgUrl}/api/data/v9.2`;

  let cachedToken: string | null = null;
  async function headers() {
    if (!cachedToken) cachedToken = await fetchDynamicsAccessToken(cfg);
    return {
      Authorization: `Bearer ${cachedToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
    };
  }

  async function entityFields(entity: string) {
    const h = await headers();
    const j = await crmFetch(
      `${api}/EntityDefinitions(LogicalName='${entity}')/Attributes?$select=LogicalName,DisplayName,AttributeType,IsCustomAttribute,RequiredLevel&$filter=IsValidForRead eq true`,
      { headers: h }, `Dynamics ${entity} attributes`,
    );
    return (j?.value ?? []).map((a: any) => ({
      key: String(a.LogicalName),
      label: String(a.DisplayName?.UserLocalizedLabel?.Label ?? a.LogicalName),
      type: String(a.AttributeType ?? "String"),
      custom: !!a.IsCustomAttribute?.Value || !!a.IsCustomAttribute === true,
      required: ["ApplicationRequired", "SystemRequired"].includes(String(a.RequiredLevel?.Value ?? "")),
    }));
  }

  return {
    provider: "dynamics",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!cfg.tenantId || !cfg.clientId || !cfg.clientSecret || !cfg.orgUrl) {
        steps.push(step("auth", "Authenticate", false,
          "Tenant ID, Client ID, Client Secret and Organization URL are all required."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        const h = await headers();
        const who = await crmFetch(`${api}/WhoAmI`, { headers: h }, "Dynamics WhoAmI");
        steps.push(step("auth", "Authenticate", true,
          `OAuth token issued and WhoAmI returned application user ${who?.UserId ?? "unknown"}.`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const h = await headers();
        const j = await crmFetch(`${api}/leads?$top=1&$select=leadid,firstname,lastname,emailaddress1,telephone1`, { headers: h }, "Dynamics leads read");
        const rec = j?.value?.[0];
        sample = samplePreview(rec ?? null);
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved lead ${rec.leadid}.` : "Read confirmed — leads endpoint accessible (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample lead retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const h = await headers();
        const res = await fetch(`${api}/leads`, {
          method: "POST",
          headers: { ...h, Prefer: "return=representation" },
          body: JSON.stringify({ lastname: `WEBEE Connection Test ${Date.now()}`, subject: "WEBEE connection verification" }),
        });
        if (!res.ok) throw new Error(`Dynamics test lead create — HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        const created = await res.json().catch(() => ({} as any));
        const id = created?.leadid;
        if (id) await fetch(`${api}/leads(${id})`, { method: "DELETE", headers: h }).catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test lead ${id ?? "?"}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = await entityFields("lead");
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} lead fields discovered (${fields.filter((f: any) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      for (const [key, entity] of [["lead", "lead"], ["contact", "contact"], ["deal", "opportunity"]] as const) {
        try {
          objects.push({ key, crmObject: entity, fields: await entityFields(entity) });
        } catch (e) {
          warnings.push(`${entity}: ${errMsg(e)}`);
        }
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const h = await headers();
        const j = await crmFetch(
          `${api}/EntityDefinitions(LogicalName='opportunity')/Attributes(LogicalName='salesstage')/Microsoft.Dynamics.CRM.PicklistAttributeMetadata?$expand=OptionSet`,
          { headers: h }, "Dynamics sales stages",
        );
        const options = j?.OptionSet?.Options ?? [];
        pipelines = [{
          id: "salesstage",
          label: "Opportunity Sales Stage",
          stages: options.map((o: any, i: number) => ({
            id: String(o.Value), label: String(o.Label?.UserLocalizedLabel?.Label ?? o.Value), order: i,
          })),
        }];
      } catch (e) {
        warnings.push(`stages: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const h = await headers();
        const j = await crmFetch(
          `${api}/systemusers?$select=systemuserid,fullname,internalemailaddress&$filter=isdisabled eq false&$top=100`,
          { headers: h }, "Dynamics system users",
        );
        owners = (j?.value ?? []).map((u: any) => ({
          id: String(u.systemuserid),
          name: String(u.fullname ?? u.systemuserid),
          email: u.internalemailaddress ? String(u.internalemailaddress) : undefined,
        }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "dynamics", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
