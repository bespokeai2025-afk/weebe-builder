/**
 * WBAH HiveMind call metrics — server-only fetcher.
 *
 * Reads WBAH's real call activity from `wbah_calls` (service-role client:
 * the table is RLS-protected) over the Europe/London day window. On any
 * query failure this returns status:"error" so HiveMind reports the data as
 * unavailable — never a fabricated zero.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  computeWbahCallMetrics,
  londonDayWindowUtc,
  londonMonthStartUtc,
  wbahCallMetricsError,
  type WbahCallMetrics,
  type WbahCallRowLike,
} from "@/lib/hivemind/wbah-call-metrics.shared";

const PAGE = 1000; // PostgREST hard cap per request
const MAX_PAGES = 5; // 5,000 calls/day safety cap

export async function fetchWbahCallMetrics(
  workspaceId: string,
  now: Date = new Date(),
): Promise<WbahCallMetrics> {
  const window = londonDayWindowUtc(now);
  try {
    const sb = supabaseAdmin as any;
    const fromIso = window.startUtc.toISOString();
    const toIso = window.endUtc.toISOString();

    // Today's rows — paged past the 1000-row PostgREST cap, deduped downstream
    // by retell_call_id. started_at is the same timestamp field the Calls pages use.
    const rowsToday: WbahCallRowLike[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await sb
        .from("wbah_calls")
        .select("id,sentiment,end_reason,started_at,synced_at")
        .eq("workspace_id", workspaceId)
        .gte("started_at", fromIso)
        .lt("started_at", toIso)
        .order("started_at", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw new Error(`wbah_calls today query failed: ${error.message}`);
      // The authoritative Retell call id IS the row id when it looks like
      // `call_<hex>`; weak/fallback ids stay distinct (see wbah-calls weak-id history).
      rowsToday.push(
        ...(data ?? []).map((r: any) => ({
          ...r,
          retell_call_id: typeof r.id === "string" && r.id.startsWith("call_") ? r.id : null,
        })),
      );
      if ((data ?? []).length < PAGE) break;
      if (page === MAX_PAGES - 1) {
        // Page cap hit — totals may undercount. Treat as delayed/unreliable rather
        // than silently reporting a truncated figure.
        console.error(`[HiveMind] WBAH calls page cap hit (${MAX_PAGES * PAGE} rows) — flagging as unavailable`);
        return wbahCallMetricsError(window);
      }
    }

    // London-month total (count only — all outcomes, no filters).
    const monthStartIso = londonMonthStartUtc(now).toISOString();
    const { count: monthCount, error: monthErr } = await sb
      .from("wbah_calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("started_at", monthStartIso);
    if (monthErr) throw new Error(`wbah_calls month count failed: ${monthErr.message}`);

    // Newest sync timestamp (source health / freshness signal).
    const { data: newest, error: newestErr } = await sb
      .from("wbah_calls")
      .select("synced_at")
      .eq("workspace_id", workspaceId)
      .order("synced_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newestErr) throw new Error(`wbah_calls newest-sync query failed: ${newestErr.message}`);

    return computeWbahCallMetrics({
      rowsToday,
      monthTotal: monthCount ?? 0,
      newestSyncAt: newest?.synced_at ?? null,
      windowStartUtc: window.startUtc,
      windowEndUtc: window.endUtc,
      now,
    });
  } catch (e: any) {
    console.error("[HiveMind] WBAH call metrics fetch error:", e?.message ?? e);
    return wbahCallMetricsError(window);
  }
}
