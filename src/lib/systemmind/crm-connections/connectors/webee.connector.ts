// ── WEBEE internal CRM connector (Task #457) ──────────────────────────────────
// The workspace's own WEBEE CRM (leads table + pipeline). No external
// credentials needed — verifies internal read/write against the shared DB.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  type CrmConnector, type CrmTestReport, type CrmDiscoverySnapshot, type CrmTestStep,
  step, report, samplePreview, errMsg,
} from "../contract";

const LEAD_FIELDS = [
  ["full_name", "Full Name", "text", false], ["email", "Email", "email", false],
  ["phone", "Phone", "phone", true], ["company_name", "Company", "text", false],
  ["source", "Source", "single_select", true], ["status", "Status", "single_select", true],
  ["notes", "Notes", "text", false], ["sentiment", "Sentiment", "text", false],
  ["call_summary", "Call Summary", "text", false], ["pipeline_stage", "Pipeline Stage", "text", false],
  ["lead_score", "Lead Score", "number", false], ["last_contacted_at", "Last Contacted At", "datetime", false],
  ["meta", "Meta (custom fields)", "json", false],
] as const;

const PIPELINE_STAGES = [
  "need_to_call", "contacted", "interested", "qualified", "booked", "not_interested", "disqualified",
];

export function buildWebeeConnector(_creds: Record<string, string>, ctx: { workspaceId: string }): CrmConnector {
  const sb = supabaseAdmin as any;
  const workspaceId = ctx.workspaceId;

  return {
    provider: "webee",

    async testConnection(): Promise<CrmTestReport> {
      const steps: CrmTestStep[] = [];
      let sample: Record<string, string> | null = null;

      steps.push(step("auth", "Authenticate", true,
        "Internal WEBEE CRM — authenticated via your workspace session; no external credentials required."));

      try {
        const { data, error, count } = await sb
          .from("leads")
          .select("id, full_name, email, phone, status, source", { count: "exact" })
          .eq("workspace_id", workspaceId)
          .limit(1);
        if (error) throw new Error(error.message);
        const rec = data?.[0];
        sample = samplePreview(rec ?? null);
        steps.push(step("read", "Read access", true,
          `Read confirmed — workspace has ${count ?? 0} lead(s).`));
        if (sample) steps.push(step("sample_record", "Sample record", true, "Sample lead retrieved."));
      } catch (e) {
        steps.push(step("read", "Read access", false, errMsg(e)));
      }

      try {
        const { data: created, error } = await sb
          .from("leads")
          .insert({
            workspace_id: workspaceId,
            full_name: `WEBEE Connection Test ${Date.now()}`,
            phone: "+10000000000",
            source: "import",
            status: "need_to_call",
            meta: { webee_connection_test: true },
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        await sb.from("leads").delete().eq("id", created.id).eq("workspace_id", workspaceId);
        steps.push(step("write", "Write access", true,
          `Write confirmed — created and removed test lead ${created.id}.`));
      } catch (e) {
        steps.push(step("write", "Write access", false, errMsg(e)));
      }

      steps.push(step("discovery_preview", "Field discovery", true,
        `${LEAD_FIELDS.length} lead fields available (plus unlimited custom fields via meta).`));

      return report(steps, { sampleRecord: sample, fieldCount: LEAD_FIELDS.length });
    },

    async discover(): Promise<CrmDiscoverySnapshot> {
      const warnings: string[] = [];
      let owners: CrmDiscoverySnapshot["owners"] = [];
      try {
        const { data: members } = await sb
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .limit(100);
        const ids = (members ?? []).map((m: any) => m.user_id);
        if (ids.length) {
          const { data: profiles } = await sb
            .from("profiles")
            .select("user_id, full_name, email")
            .in("user_id", ids);
          owners = (profiles ?? []).map((p: any) => ({
            id: String(p.user_id),
            name: String(p.full_name ?? p.email ?? p.user_id),
            email: p.email ? String(p.email) : undefined,
          }));
        }
      } catch (e) {
        warnings.push(`owners: ${errMsg(e)}`);
      }

      return {
        provider: "webee",
        objects: [{
          key: "lead",
          crmObject: "leads",
          fields: LEAD_FIELDS.map(([key, label, type, required]) => ({ key, label, type, custom: false, required })),
        }],
        pipelines: [{
          id: "lead-status",
          label: "Lead Status Pipeline",
          stages: PIPELINE_STAGES.map((s, i) => ({ id: s, label: s.replace(/_/g, " "), order: i })),
        }],
        owners,
        discoveredAt: new Date().toISOString(),
        warnings,
      };
    },
  };
}
