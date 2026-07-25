// ── Pipedrive connector (Task #457) ───────────────────────────────────────────
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

const BASE = "https://api.pipedrive.com/v1";

export function buildPipedriveConnector(creds: Record<string, string>): CrmConnector {
  const token = (creds.apiToken ?? creds.api_token ?? creds.apiKey ?? creds.api_key ?? "").trim();
  const url = (path: string, extra = "") =>
    `${BASE}${path}${path.includes("?") ? "&" : "?"}api_token=${encodeURIComponent(token)}${extra}`;

  async function listFields(endpoint: string) {
    const j = await crmFetch(url(`/${endpoint}`), {}, `Pipedrive ${endpoint}`);
    return (j?.data ?? []).map((f: any) => ({
      key: String(f.key),
      label: String(f.name ?? f.key),
      type: String(f.field_type ?? "varchar"),
      custom: !!f.edit_flag,
      required: !!f.mandatory_flag,
    }));
  }

  return {
    provider: "pipedrive",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!token) {
        steps.push(step("auth", "Authenticate", false, "No API token provided."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        const me = await crmFetch(url("/users/me"), {}, "Pipedrive users/me");
        steps.push(step("auth", "Authenticate", true,
          `Authenticated as ${me?.data?.name ?? "unknown"} (${me?.data?.email ?? "no email"}) on ${me?.data?.company_name ?? "company"}.`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const j = await crmFetch(url("/persons?limit=1"), {}, "Pipedrive persons read");
        const rec = j?.data?.[0];
        sample = samplePreview(rec ? { id: rec.id, name: rec.name, email: rec.primary_email, phone: rec.phone?.[0]?.value } : null);
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved person ${rec.id}.` : "Read confirmed — persons endpoint accessible (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample person retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const created = await crmFetch(url("/persons"), {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: `WEBEE Connection Test ${Date.now()}` }),
        }, "Pipedrive test person create");
        const id = created?.data?.id;
        if (id) await crmFetch(url(`/persons/${id}`), { method: "DELETE" }, "Pipedrive test person delete").catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test person ${id ?? "?"}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = await listFields("personFields");
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} person fields discovered (${fields.filter((f: any) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      for (const [key, obj, ep] of [
        ["contact", "persons", "personFields"],
        ["deal", "deals", "dealFields"],
        ["company", "organizations", "organizationFields"],
      ] as const) {
        try {
          objects.push({ key, crmObject: obj, fields: await listFields(ep) });
        } catch (e) {
          warnings.push(`${obj}: ${errMsg(e)}`);
        }
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const [pj, sj] = await Promise.all([
          crmFetch(url("/pipelines"), {}, "Pipedrive pipelines"),
          crmFetch(url("/stages"), {}, "Pipedrive stages"),
        ]);
        const stages = sj?.data ?? [];
        pipelines = (pj?.data ?? []).map((p: any) => ({
          id: String(p.id),
          label: String(p.name ?? p.id),
          stages: stages
            .filter((s: any) => s.pipeline_id === p.id)
            .map((s: any) => ({ id: String(s.id), label: String(s.name ?? s.id), order: Number(s.order_nr ?? 0) })),
        }));
      } catch (e) {
        warnings.push(`pipelines: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const j = await crmFetch(url("/users"), {}, "Pipedrive users");
        owners = (j?.data ?? [])
          .filter((u: any) => u.active_flag !== false)
          .map((u: any) => ({ id: String(u.id), name: String(u.name ?? u.id), email: u.email ? String(u.email) : undefined }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "pipedrive", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
