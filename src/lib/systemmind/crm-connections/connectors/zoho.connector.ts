// ── Zoho CRM connector (Task #457) ────────────────────────────────────────────
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep, type CrmCredentialRefreshResult,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

export function buildZohoConnector(creds: Record<string, string>): CrmConnector {
  let accessToken = (creds.accessToken ?? creds.access_token ?? "").trim();
  const apiDomain = (creds.apiDomain ?? creds.api_domain ?? "https://www.zohoapis.com").trim().replace(/\/+$/, "");
  const refreshToken = (creds.refreshToken ?? creds.refresh_token ?? "").trim();
  const clientId = (creds.clientId ?? creds.client_id ?? "").trim();
  const clientSecret = (creds.clientSecret ?? creds.client_secret ?? "").trim();
  const accountsUrl = (creds.accountsUrl ?? creds.accounts_url ?? "https://accounts.zoho.com").trim().replace(/\/+$/, "");

  const headers = () => ({
    "Content-Type": "application/json",
    Authorization: `Zoho-oauthtoken ${accessToken}`,
  });

  const refreshCredentials = async (): Promise<CrmCredentialRefreshResult | null> => {
    if (!refreshToken || !clientId || !clientSecret) return null;
    const body = new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken,
      client_id: clientId, client_secret: clientSecret,
    });
    const j = await crmFetch(`${accountsUrl}/oauth/v2/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    }, "Zoho token refresh");
    if (!j?.access_token) return null;
    accessToken = String(j.access_token);
    const expiresAt = j.expires_in
      ? new Date(Date.now() + Number(j.expires_in) * 1000).toISOString()
      : undefined;
    return { updated: { accessToken }, expiresAt };
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

  async function moduleFields(module: string) {
    const j = await crmFetch(`${apiDomain}/crm/v6/settings/fields?module=${encodeURIComponent(module)}`, { headers: headers() }, `Zoho ${module} fields`);
    return (j?.fields ?? []).map((f: any) => ({
      key: String(f.api_name),
      label: String(f.display_label ?? f.api_name),
      type: String(f.data_type ?? "text"),
      custom: !!f.custom_field,
      required: !!f.system_mandatory,
    }));
  }

  return {
    provider: "zoho",
    refreshCredentials,

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!accessToken && !(refreshToken && clientId && clientSecret)) {
        steps.push(step("auth", "Authenticate", false,
          "Provide an Access Token, or a Refresh Token with Client ID + Client Secret."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        if (!accessToken) await refreshCredentials();
        const { result: me, refreshed } = await withRefresh(() =>
          crmFetch(`${apiDomain}/crm/v6/users?type=CurrentUser`, { headers: headers() }, "Zoho current user"));
        const u = me?.users?.[0];
        steps.push(step("auth", "Authenticate", true,
          `Authenticated as ${u?.full_name ?? "unknown"} (${u?.email ?? "no email"}) on ${apiDomain}${refreshed ? " — access token auto-refreshed" : ""}.`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const j = await crmFetch(`${apiDomain}/crm/v6/Leads?per_page=1&fields=First_Name,Last_Name,Email,Phone,Company`, { headers: headers() }, "Zoho leads read");
        const rec = j?.data?.[0];
        sample = samplePreview(rec ?? null);
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved lead ${rec.id}.` : "Read confirmed — Leads module accessible (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample lead retrieved."));
      } catch (e: any) {
        // Zoho returns 204 for empty modules; crmFetch handles 204 as null
        if (e?.status === 204) steps.push(step("read", "Read access", true, "Read confirmed — Leads module accessible (empty)."));
        else steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const created = await crmFetch(`${apiDomain}/crm/v6/Leads`, {
          method: "POST", headers: headers(),
          body: JSON.stringify({ data: [{ Last_Name: `WEBEE Connection Test ${Date.now()}`, Company: "WEBEE Verification" }] }),
        }, "Zoho test lead create");
        const id = created?.data?.[0]?.details?.id;
        if (id) await crmFetch(`${apiDomain}/crm/v6/Leads/${id}`, { method: "DELETE", headers: headers() }, "Zoho test lead delete").catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test lead ${id ?? "?"} (moved to Recycle Bin).`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = await moduleFields("Leads");
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} lead fields discovered (${fields.filter((f: any) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      if (!accessToken && refreshToken && clientId && clientSecret) await refreshCredentials().catch(() => null);
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      for (const [key, module] of [["lead", "Leads"], ["contact", "Contacts"], ["deal", "Deals"]] as const) {
        try {
          objects.push({ key, crmObject: module, fields: await moduleFields(module) });
        } catch (e) {
          warnings.push(`${module}: ${errMsg(e)}`);
        }
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const j = await crmFetch(`${apiDomain}/crm/v6/settings/fields?module=Deals`, { headers: headers() }, "Zoho deal stages");
        const stageField = (j?.fields ?? []).find((f: any) => f.api_name === "Stage");
        const values = stageField?.pick_list_values ?? [];
        pipelines = [{
          id: "deals-stage",
          label: "Deal Stages",
          stages: values.map((v: any, i: number) => ({
            id: String(v.id ?? v.actual_value ?? i),
            label: String(v.display_value ?? v.actual_value ?? i),
            order: Number(v.sequence_number ?? i),
          })),
        }];
      } catch (e) {
        warnings.push(`stages: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const j = await crmFetch(`${apiDomain}/crm/v6/users?type=ActiveUsers`, { headers: headers() }, "Zoho users");
        owners = (j?.users ?? []).map((u: any) => ({
          id: String(u.id), name: String(u.full_name ?? u.id), email: u.email ? String(u.email) : undefined,
        }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "zoho", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
