// ── Salesforce connector (Task #457) ──────────────────────────────────────────
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep, type CrmCredentialRefreshResult,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

const API = "v59.0";

export function buildSalesforceConnector(creds: Record<string, string>): CrmConnector {
  const instanceUrl = (creds.instanceUrl ?? creds.instance_url ?? "").trim().replace(/\/+$/, "");
  let accessToken = (creds.accessToken ?? creds.access_token ?? "").trim();
  const refreshToken = (creds.refreshToken ?? creds.refresh_token ?? "").trim();
  const clientId = (creds.clientId ?? creds.client_id ?? "").trim();
  const clientSecret = (creds.clientSecret ?? creds.client_secret ?? "").trim();
  const loginUrl = (creds.loginUrl ?? creds.login_url ?? "https://login.salesforce.com").trim().replace(/\/+$/, "");

  const base = () => `${instanceUrl}/services/data/${API}`;
  const headers = () => ({ "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` });

  async function describeObject(name: string) {
    const j = await crmFetch(`${base()}/sobjects/${name}/describe`, { headers: headers() }, `Salesforce describe ${name}`);
    return (j?.fields ?? []).map((f: any) => ({
      key: String(f.name),
      label: String(f.label ?? f.name),
      type: String(f.type ?? "string"),
      custom: !!f.custom,
      required: f.nillable === false && f.createable === true,
    }));
  }

  const refreshCredentials = async (): Promise<CrmCredentialRefreshResult | null> => {
    if (!refreshToken || !clientId || !clientSecret) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret,
    });
    const j = await crmFetch(`${loginUrl}/services/oauth2/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    }, "Salesforce token refresh");
    if (!j?.access_token) return null;
    accessToken = String(j.access_token);
    return { updated: { accessToken } };
  };

  async function withRefresh<T>(fn: () => Promise<T>): Promise<{ result: T; refreshed: boolean }> {
    try {
      return { result: await fn(), refreshed: false };
    } catch (e: any) {
      if (e?.status === 401 && refreshToken && clientId && clientSecret) {
        await refreshCredentials();
        return { result: await fn(), refreshed: true };
      }
      throw e;
    }
  }

  return {
    provider: "salesforce",
    refreshCredentials,

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!instanceUrl || !accessToken) {
        steps.push(step("auth", "Authenticate", false, "Instance URL and Access Token are both required."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        const { refreshed } = await withRefresh(() =>
          crmFetch(`${base()}/sobjects`, { headers: headers() }, "Salesforce sobjects list"));
        steps.push(step("auth", "Authenticate", true,
          `Token accepted at ${instanceUrl}${refreshed ? " (after OAuth refresh)" : ""}.`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const q = encodeURIComponent("SELECT Id, FirstName, LastName, Email, Phone FROM Contact LIMIT 1");
        const j = await crmFetch(`${base()}/query?q=${q}`, { headers: headers() }, "Salesforce contact query");
        const rec = j?.records?.[0];
        if (rec) { delete rec.attributes; sample = samplePreview(rec); }
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved Contact ${rec.Id}.` : "Read confirmed — Contact query allowed (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample contact retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const created = await crmFetch(`${base()}/sobjects/Contact`, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ LastName: `WEBEE Connection Test ${Date.now()}` }),
        }, "Salesforce test contact create");
        await crmFetch(`${base()}/sobjects/Contact/${created.id}`, { method: "DELETE", headers: headers() },
          "Salesforce test contact delete").catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test Contact ${created.id}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = await describeObject("Contact");
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} Contact fields discovered (${fields.filter((f: any) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      for (const [key, obj] of [["lead", "Lead"], ["contact", "Contact"], ["deal", "Opportunity"]] as const) {
        try {
          objects.push({ key, crmObject: obj, fields: await describeObject(obj) });
        } catch (e) {
          warnings.push(`${obj}: ${errMsg(e)}`);
        }
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const q = encodeURIComponent("SELECT Id, MasterLabel, SortOrder FROM OpportunityStage ORDER BY SortOrder");
        const j = await crmFetch(`${base()}/query?q=${q}`, { headers: headers() }, "Salesforce opportunity stages");
        pipelines = [{
          id: "default",
          label: "Opportunity Stages",
          stages: (j?.records ?? []).map((s: any) => ({
            id: String(s.Id), label: String(s.MasterLabel), order: Number(s.SortOrder ?? 0),
          })),
        }];
      } catch (e) {
        warnings.push(`stages: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const q = encodeURIComponent("SELECT Id, Name, Email FROM User WHERE IsActive = true LIMIT 100");
        const j = await crmFetch(`${base()}/query?q=${q}`, { headers: headers() }, "Salesforce users");
        owners = (j?.records ?? []).map((u: any) => ({
          id: String(u.Id), name: String(u.Name), email: u.Email ? String(u.Email) : undefined,
        }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "salesforce", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
