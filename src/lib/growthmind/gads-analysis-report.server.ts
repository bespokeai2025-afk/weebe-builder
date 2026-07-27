/**
 * Server fns for reading stored GrowthMind Google Ads deep-analysis reports.
 * Reads go through the caller's RLS client (workspace members only).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SELECT_COLS =
  "id, workspace_id, account_row_id, work_order_id, task_id, execution_id, campaign_id, campaign_name, period_days, date_from, date_to, status, sections, source_meta, created_at";

export const getGadsAnalysisReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({
      reportId: z.string().uuid().optional(),
      workOrderId: z.string().uuid().optional(),
    }).refine(v => v.reportId || v.workOrderId, "reportId or workOrderId required").parse(input))
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;
    let q = sb.from("growthmind_gads_analysis_reports").select(SELECT_COLS).eq("workspace_id", workspaceId);
    if (data.reportId) q = q.eq("id", data.reportId);
    else q = q.eq("work_order_id", data.workOrderId!);
    const { data: rows, error } = await q.order("created_at", { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    return (rows?.[0] ?? null) as any;
  });

export const listGadsAnalysisReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data: rows, error } = await (context.supabase as any)
      .from("growthmind_gads_analysis_reports")
      .select("id, campaign_id, campaign_name, date_from, date_to, status, work_order_id, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).limit(25);
    if (error) throw new Error(error.message);
    return (rows ?? []) as any[];
  });
