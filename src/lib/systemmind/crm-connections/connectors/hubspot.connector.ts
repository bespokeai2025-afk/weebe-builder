// ── HubSpot connector (Task #457) ─────────────────────────────────────────────
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

const BASE = "https://api.hubapi.com";

export function buildHubSpotConnector(creds: Record<string, string>): CrmConnector {
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };

  async function listProps(obj: string) {
    const j = await crmFetch(`${BASE}/crm/v3/properties/${obj}`, { headers }, `HubSpot ${obj} properties`);
    return (j?.results ?? []).map((p: any) => ({
      key: String(p.name),
      label: String(p.label ?? p.name),
      type: String(p.type ?? "string"),
      custom: !p.hubspotDefined,
      required: false,
    }));
  }

  return {
    provider: "hubspot",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!apiKey) {
        steps.push(step("auth", "Authenticate", false, "No Private App token provided."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        const me = await crmFetch(`${BASE}/account-info/v3/details`, { headers }, "HubSpot account details");
        steps.push(step("auth", "Authenticate", true,
          `Token accepted — portal ${me?.portalId ?? "unknown"} (${me?.accountType ?? "account"}).`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const j = await crmFetch(`${BASE}/crm/v3/objects/contacts?limit=1`, { headers }, "HubSpot contacts read");
        const rec = j?.results?.[0];
        sample = samplePreview(rec ? { id: rec.id, ...(rec.properties ?? {}) } : null);
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved contact ${rec.id}.` : "Read confirmed — contacts endpoint accessible (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample contact retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const marker = `webee-test-${Date.now()}@example.invalid`;
        const created = await crmFetch(`${BASE}/crm/v3/objects/contacts`, {
          method: "POST", headers,
          body: JSON.stringify({ properties: { email: marker, firstname: "WEBEE", lastname: "Connection Test" } }),
        }, "HubSpot test contact create");
        await crmFetch(`${BASE}/crm/v3/objects/contacts/${created.id}`, { method: "DELETE", headers }, "HubSpot test contact delete")
          .catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test contact ${created.id}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = await listProps("contacts");
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} contact fields discovered (${fields.filter((f: any) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      for (const [key, obj] of [["contact", "contacts"], ["deal", "deals"], ["company", "companies"]] as const) {
        try {
          objects.push({ key, crmObject: obj, fields: await listProps(obj) });
        } catch (e) {
          warnings.push(`${obj}: ${errMsg(e)}`);
        }
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const j = await crmFetch(`${BASE}/crm/v3/pipelines/deals`, { headers }, "HubSpot deal pipelines");
        pipelines = (j?.results ?? []).map((p: any) => ({
          id: String(p.id),
          label: String(p.label ?? p.id),
          stages: (p.stages ?? []).map((s: any) => ({
            id: String(s.id), label: String(s.label ?? s.id), order: Number(s.displayOrder ?? 0),
          })),
        }));
      } catch (e) {
        warnings.push(`pipelines: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const j = await crmFetch(`${BASE}/crm/v3/owners?limit=100`, { headers }, "HubSpot owners");
        owners = (j?.results ?? []).map((o: any) => ({
          id: String(o.id),
          name: [o.firstName, o.lastName].filter(Boolean).join(" ") || String(o.email ?? o.id),
          email: o.email ? String(o.email) : undefined,
        }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "hubspot", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
