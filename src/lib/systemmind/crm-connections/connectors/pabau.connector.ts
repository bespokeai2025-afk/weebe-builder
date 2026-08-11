// ── Pabau connector (DNR medical receptionist) ────────────────────────────────
import {
  pabauListItems,
  pabauRequestHeaders,
  pabauSampleRecord,
  resolvePabauApiBase,
  pabauFetch,
} from "@/lib/pabau/pabau-api.shared";
import { pabauProbeReceptionistAccess } from "@/lib/pabau/pabau-receptionist.server";
import {
  type CrmConnector,
  type CrmDiscoverySnapshot,
  type CrmTestReport,
  type CrmTestStep,
  type DiscoveredObject,
  errMsg,
  report,
  samplePreview,
  step,
} from "../contract";

const DISCOVERY_PATHS = [
  { key: "appointment", crmObject: "appointments", path: "/appointments", kind: "appointment" as const },
  { key: "lead", crmObject: "leads", path: "/leads", kind: "lead" as const },
  { key: "service", crmObject: "service_categories", path: "/categories/services", kind: "lead" as const },
] as const;

export function buildPabauConnector(creds: Record<string, string>): CrmConnector {
  const apiKey = (creds.apiKey ?? creds.api_key ?? "").trim();
  const base = resolvePabauApiBase(apiKey, creds.baseUrl ?? creds.base_url);
  const headers = pabauRequestHeaders();
  const clientConfig = { apiKey, baseUrl: creds.baseUrl ?? creds.base_url };

  return {
    provider: "pabau",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      if (!apiKey) {
        steps.push(step("auth", "Authenticate", false, "No API key provided."));
        return report(steps);
      }

      const { ok, probes } = await pabauProbeReceptionistAccess(clientConfig);
      if (!ok) {
        const detail = probes
          .map((p) => `${p.endpoint}: ${p.detail}`)
          .join(" | ");
        steps.push(
          step(
            "auth",
            "Authenticate",
            false,
            `${detail} — Enable Appointments, Leads, and Services read on the API key in Pabau → Setup → API Keys.`,
          ),
        );
        return report(steps);
      }

      steps.push(
        step(
          "auth",
          "Authenticate",
          true,
          `API key accepted via ${probes.filter((p) => p.ok).map((p) => p.endpoint).join(", ")}.`,
        ),
      );

      const readLines = probes.map((p) =>
        p.ok ? `${p.endpoint} (${p.detail})` : `${p.endpoint} denied`,
      );
      steps.push(step("read", "Read access", true, readLines.join(" · ")));

      let sample: Record<string, string> | null = null;
      let fieldCount: number | null = null;
      for (const probe of probes) {
        if (!probe.ok || probe.endpoint !== "/appointments") continue;
        try {
          const json = await pabauFetch(`${base}/appointments`, { headers }, "Pabau sample appointment");
          sample = samplePreview(pabauSampleRecord(json, "appointment"));
          if (sample) {
            fieldCount = Object.keys(sample).length;
            steps.push(step("sample_record", "Sample record", true, "Sample appointment/client retrieved."));
          }
          break;
        } catch {
          /* fall through to leads */
        }
      }
      if (!sample) {
        try {
          const json = await pabauFetch(`${base}/leads`, { headers }, "Pabau sample lead");
          sample = samplePreview(pabauSampleRecord(json, "lead"));
          if (sample) {
            fieldCount = Object.keys(sample).length;
            steps.push(step("sample_record", "Sample record", true, "Sample lead retrieved."));
          }
        } catch (e) {
          steps.push(step("sample_record", "Sample record", false, errMsg(e)));
        }
      }

      const apptRead = probes.find((p) => p.endpoint === "/appointments")?.ok;
      const servicesRead = probes.find((p) => p.endpoint === "/categories/services")?.ok;
      steps.push(
        step(
          "write",
          "Booking readiness",
          apptRead && servicesRead,
          apptRead && servicesRead
            ? "Appointments + services readable — ready for /appointments/create when Retell tools are wired."
            : "Enable Appointments (read/write) and Services (read) on the API key for live booking.",
          !(apptRead && servicesRead),
        ),
      );

      steps.push(
        step(
          "discovery_preview",
          "Receptionist endpoints",
          true,
          "appointments · leads · categories/services · clients/{id} · appointments/create",
        ),
      );

      return report(steps, { sampleRecord: sample, fieldCount });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      const objects: DiscoveredObject[] = [];

      for (const { key, crmObject, path, kind } of DISCOVERY_PATHS) {
        try {
          const json = await pabauFetch(`${base}${path}`, { headers }, `Pabau ${crmObject}`);
          const items = pabauListItems(json);
          const rec =
            kind === "appointment" && path === "/appointments"
              ? pabauSampleRecord(json, "appointment")
              : items[0];
          const fields =
            rec && typeof rec === "object"
              ? Object.keys(rec as Record<string, unknown>).map((k) => ({
                  key: k,
                  label: k,
                  type: typeof (rec as Record<string, unknown>)[k],
                  custom: false,
                }))
              : [];
          objects.push({ key, crmObject, fields });
        } catch (e) {
          warnings.push(`${crmObject}: ${errMsg(e)}`);
        }
      }

      return {
        provider: "pabau",
        objects,
        pipelines: [],
        owners: [],
        discoveredAt: new Date().toISOString(),
        warnings,
      };
    },
  };
}
