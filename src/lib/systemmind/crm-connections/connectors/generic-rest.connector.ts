// ── Generic REST CRM connector (Task #457) ────────────────────────────────────
// Configurable connector for any REST-style CRM: base URL + auth style
// (bearer / API-key header / basic / custom headers) + endpoint paths.
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot,
  type DiscoveredObject, type CrmTestStep,
  step, report, samplePreview, crmFetch, errMsg,
} from "../contract";

function digDeep(obj: any, path: string): any {
  if (!path) return obj;
  return path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

function firstRecord(payload: any, arrayPath?: string): Record<string, unknown> | null {
  const candidates = [
    arrayPath ? digDeep(payload, arrayPath) : null,
    payload?.data, payload?.results, payload?.items, payload?.records,
    Array.isArray(payload) ? payload : null,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length && typeof c[0] === "object") return c[0] as Record<string, unknown>;
  }
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
}

export function buildGenericRestConnector(creds: Record<string, string>): CrmConnector {
  const baseUrl = (creds.baseUrl ?? creds.base_url ?? "").trim().replace(/\/+$/, "");
  const authStyle = (creds.authStyle ?? creds.auth_style ?? "bearer").trim();
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  const headerName = (creds.apiKeyHeader ?? creds.api_key_header ?? "X-API-Key").trim();
  const username = (creds.username ?? "").trim();
  const password = (creds.password ?? "").trim();
  const testPath = (creds.testPath ?? creds.test_path ?? "/").trim();
  const listPath = (creds.listPath ?? creds.list_path ?? "").trim();
  const createPath = (creds.createPath ?? creds.create_path ?? "").trim();
  const arrayPath = (creds.arrayPath ?? creds.array_path ?? "").trim();

  function headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (authStyle === "bearer" && apiKey) h.Authorization = `Bearer ${apiKey}`;
    else if (authStyle === "api_key_header" && apiKey) h[headerName] = apiKey;
    else if (authStyle === "basic" && username) h.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
    if (creds.customHeaders ?? creds.custom_headers) {
      try {
        Object.assign(h, JSON.parse(String(creds.customHeaders ?? creds.custom_headers)));
      } catch { /* invalid JSON — ignored, surfaced by test */ }
    }
    return h;
  }

  const url = (p: string) => `${baseUrl}${p.startsWith("/") ? p : `/${p}`}`;

  return {
    provider: "generic_rest",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!baseUrl) {
        steps.push(step("auth", "Authenticate", false, "Base URL is required."));
        return report(steps);
      }
      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;

      try {
        await crmFetch(url(testPath), { headers: headers() }, "Test endpoint");
        steps.push(step("auth", "Authenticate", true,
          `Authenticated request to ${testPath} succeeded (${authStyle} auth).`));
      } catch (e) {
        steps.push(step("auth", "Authenticate", false, errMsg(e)));
        return report(steps);
      }

      if (listPath) {
        try {
          const j = await crmFetch(url(listPath), { headers: headers() }, "List endpoint");
          const rec = firstRecord(j, arrayPath);
          sample = samplePreview(rec);
          fieldCount = rec ? Object.keys(rec).length : 0;
          steps.push(step("read", "Read access", true,
            rec ? `Read confirmed — record retrieved from ${listPath} (${fieldCount} fields).` : `Read confirmed — ${listPath} accessible (no records).`));
          if (sample) steps.push(step("sample_record", "Sample record", true, "Sample record retrieved."));
          if (fieldCount) steps.push(step("discovery_preview", "Field discovery", true, `${fieldCount} fields inferred from a live record.`));
        } catch (e) {
          steps.push(step("read", "Read access", false, errMsg(e)));
        }
      } else {
        steps.push(step("read", "Read access", false, "No list endpoint configured — read access not verified.", true));
      }

      if (createPath) {
        try {
          await crmFetch(url(createPath), {
            method: "POST", headers: headers(),
            body: JSON.stringify({ name: `WEBEE Connection Test ${Date.now()}`, source: "webee_connection_test", test: true }),
          }, "Create endpoint");
          steps.push(step("write", "Write access", true,
            `Write confirmed — POST to ${createPath} accepted a test record (flagged test: true). Remove it in the CRM if it persists.`));
        } catch (e) {
          steps.push(step("write", "Write access", false, errMsg(e)));
        }
      } else {
        steps.push(step("write", "Write access", false, "No create endpoint configured — write access not verified.", true));
      }

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];
      if (listPath) {
        try {
          const j = await crmFetch(url(listPath), { headers: headers() }, "List endpoint");
          const rec = firstRecord(j, arrayPath);
          if (rec) {
            objects.push({
              key: "record",
              crmObject: listPath,
              fields: Object.entries(rec).map(([k, v]) => ({
                key: k, label: k,
                type: typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "text",
                custom: false,
              })),
            });
          } else {
            warnings.push("List endpoint returned no records — fields could not be inferred.");
          }
        } catch (e) {
          warnings.push(`list: ${errMsg(e)}`);
        }
      } else {
        warnings.push("No list endpoint configured — schema discovery is limited for generic REST CRMs.");
      }
      return { provider: "generic_rest", objects, pipelines: [], owners: [], discoveredAt: new Date().toISOString(), warnings };
    },
  };
}
