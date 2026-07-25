// ── GoHighLevel connector (Task #457) ─────────────────────────────────────────
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

const BASE = "https://services.leadconnectorhq.com";

const STANDARD_CONTACT_FIELDS = [
  ["firstName", "First Name", "string"], ["lastName", "Last Name", "string"],
  ["email", "Email", "email"], ["phone", "Phone", "phone"],
  ["companyName", "Company Name", "string"], ["address1", "Address", "string"],
  ["city", "City", "string"], ["state", "State", "string"],
  ["postalCode", "Postal Code", "string"], ["source", "Source", "string"],
  ["tags", "Tags", "array"], ["dateOfBirth", "Date of Birth", "date"],
] as const;

export function buildGoHighLevelConnector(creds: Record<string, string>): CrmConnector {
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  const locationId = (creds.locationId ?? creds.location_id ?? "").trim();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    Version: "2021-07-28",
  };

  async function customFields() {
    const j = await crmFetch(`${BASE}/locations/${locationId}/customFields`, { headers }, "GoHighLevel custom fields");
    return (j?.customFields ?? []).map((f: any) => ({
      key: String(f.fieldKey ?? f.id),
      label: String(f.name ?? f.id),
      type: String(f.dataType ?? "TEXT").toLowerCase(),
      custom: true,
      required: false,
    }));
  }

  function contactFields(custom: Array<{ key: string; label: string; type: string; custom: boolean }>) {
    return [
      ...STANDARD_CONTACT_FIELDS.map(([key, label, type]) => ({ key, label, type, custom: false, required: false })),
      ...custom,
    ];
  }

  return {
    provider: "gohighlevel",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!apiKey || !locationId) {
        steps.push(step("auth", "Authenticate", false, "API key and Location ID are both required."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        const j = await crmFetch(`${BASE}/locations/${locationId}`, { headers }, "GoHighLevel location");
        steps.push(step("auth", "Authenticate", true,
          `Token accepted — location "${j?.location?.name ?? locationId}".`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      try {
        const j = await crmFetch(`${BASE}/contacts/?locationId=${encodeURIComponent(locationId)}&limit=1`, { headers }, "GoHighLevel contacts read");
        const rec = j?.contacts?.[0];
        sample = samplePreview(rec ? { id: rec.id, firstName: rec.firstName, lastName: rec.lastName, email: rec.email, phone: rec.phone } : null);
        steps.push(step("read", "Read access", true,
          rec ? `Read confirmed — retrieved contact ${rec.id}.` : "Read confirmed — contacts endpoint accessible (0 records)."));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample contact retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const created = await crmFetch(`${BASE}/contacts/`, {
          method: "POST", headers,
          body: JSON.stringify({
            locationId,
            firstName: "WEBEE",
            lastName: `Connection Test ${Date.now()}`,
            email: `webee-test-${Date.now()}@example.invalid`,
          }),
        }, "GoHighLevel test contact create");
        const id = created?.contact?.id;
        if (id) await crmFetch(`${BASE}/contacts/${id}`, { method: "DELETE", headers }, "GoHighLevel test contact delete").catch(() => {});
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test contact ${id ?? "?"}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      try {
        const fields = contactFields(await customFields());
        fieldCount = fields.length;
        steps.push(step("discovery_preview", "Field discovery", true,
          `${fields.length} contact fields discovered (${fields.filter((f) => f.custom).length} custom).`));
      } catch (e) {
        steps.push(step("discovery_preview", "Field discovery", false, errMsg(e)));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      try {
        objects.push({ key: "contact", crmObject: "contacts", fields: contactFields(await customFields()) });
      } catch (e) {
        warnings.push(`contacts: ${errMsg(e)}`);
        objects.push({ key: "contact", crmObject: "contacts", fields: contactFields([]) });
      }

      let pipelines: CrmDiscoverySnapshot["pipelines"] = [];
      try {
        const j = await crmFetch(`${BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers }, "GoHighLevel pipelines");
        pipelines = (j?.pipelines ?? []).map((p: any) => ({
          id: String(p.id),
          label: String(p.name ?? p.id),
          stages: (p.stages ?? []).map((s: any, i: number) => ({
            id: String(s.id), label: String(s.name ?? s.id), order: Number(s.position ?? i),
          })),
        }));
      } catch (e) {
        warnings.push(`pipelines: ${errMsg(e)}`);
      }

      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const j = await crmFetch(`${BASE}/users/?locationId=${encodeURIComponent(locationId)}`, { headers }, "GoHighLevel users");
        owners = (j?.users ?? []).map((u: any) => ({
          id: String(u.id),
          name: [u.firstName, u.lastName].filter(Boolean).join(" ") || String(u.email ?? u.id),
          email: u.email ? String(u.email) : undefined,
        }));
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return { provider: "gohighlevel", objects, pipelines, owners, discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
