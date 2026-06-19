import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type TableLimitConfig = {
  key: string;
  label: string;
  table: string;
  softLimit: number;
  unit: string;
};

export const TABLE_LIMITS: TableLimitConfig[] = [
  { key: "calls",              label: "Calls (DB)",          table: "calls",              softLimit: 50_000,  unit: "records" },
  { key: "wbah_calls",        label: "WBAH Calls",          table: "wbah_calls",         softLimit: 100_000, unit: "records" },
  { key: "leads",              label: "Leads",               table: "leads",              softLimit: 50_000,  unit: "records" },
  { key: "contacts",          label: "Contacts",            table: "contacts",           softLimit: 50_000,  unit: "records" },
  { key: "data_records",      label: "Data Records",        table: "data_records",       softLimit: 100_000, unit: "records" },
  { key: "qualified_leads",   label: "Qualified Leads",     table: "qualified_leads",    softLimit: 50_000,  unit: "records" },
  { key: "campaign_contacts", label: "Campaign Contacts",   table: "campaign_contacts",  softLimit: 200_000, unit: "records" },
  { key: "knowledge_chunks",  label: "Knowledge Chunks",    table: "knowledge_chunks",   softLimit: 100_000, unit: "records" },
  { key: "agents",            label: "Agents",              table: "agents",             softLimit: 500,     unit: "records" },
  { key: "workspaces",        label: "Workspaces",          table: "workspaces",         softLimit: 200,     unit: "records" },
];

export type DataLimitRow = {
  key: string;
  label: string;
  table: string;
  count: number;
  softLimit: number;
  pct: number;
  level: "ok" | "warning" | "near" | "critical";
  unit: string;
};

export type DataLimitsReport = {
  rows: DataLimitRow[];
  fetchedAt: string;
};

function classifyLevel(pct: number): DataLimitRow["level"] {
  if (pct >= 90) return "critical";
  if (pct >= 75) return "near";
  if (pct >= 50) return "warning";
  return "ok";
}

export const getDataLimitsReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DataLimitsReport> => {
    const admin = supabaseAdmin;

    const rows: DataLimitRow[] = [];

    for (const cfg of TABLE_LIMITS) {
      try {
        const { count, error } = await admin
          .from(cfg.table as any)
          .select("*", { count: "exact", head: true });

        if (error) {
          rows.push({ ...cfg, count: -1, pct: 0, level: "ok" });
          continue;
        }

        const c = count ?? 0;
        const pct = Math.min(100, Math.round((c / cfg.softLimit) * 100));
        rows.push({ ...cfg, count: c, pct, level: classifyLevel(pct) });
      } catch {
        rows.push({ ...cfg, count: -1, pct: 0, level: "ok" });
      }
    }

    return { rows, fetchedAt: new Date().toISOString() };
  });
