/**
 * AccountsMind Auto-Executor
 *
 * Runs hourly (dev: Vite plugin / prod: campaign-executor cron).
 * For every workspace that has an active billing profile, it:
 *  1. Computes + stores the current month's cost snapshot
 *  2. Generates / refreshes finance alerts
 *  3. Writes a HiveMind task for any workspace with critical alerts
 *  4. Writes a GrowthMind recommendation for any loss-making workspace
 */
import { createClient } from "@supabase/supabase-js";
import {
  computeClientMonthlyCost,
  upsertClientMonthlyCost,
  generateAccountsMindAlerts,
} from "./client-costing.server";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase env vars");
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface AccountsMindTickResult {
  scanned:              number;
  updated:              number;
  alertsGenerated:      number;
  hivemindTasksPosted:  number;
  failed:               Array<{ workspaceId: string; error: string }>;
}

export async function runAccountsMindTick(): Promise<AccountsMindTickResult> {
  const result: AccountsMindTickResult = {
    scanned: 0, updated: 0, alertsGenerated: 0, hivemindTasksPosted: 0, failed: [],
  };

  let sb: ReturnType<typeof adminClient>;
  try {
    sb = adminClient();
  } catch {
    return result;
  }

  // Get all active/trialing billing profiles + workspace name
  const { data: profiles, error: profilesErr } = await sb
    .from("client_billing_profiles")
    .select("workspace_id, status")
    .in("status", ["active", "trialing"]);

  if (profilesErr || !profiles?.length) return result;

  // Fetch workspace names in one shot
  const workspaceIds = profiles.map(p => p.workspace_id);
  const { data: workspaces } = await sb
    .from("workspace_settings")
    .select("workspace_id, workspace_name")
    .in("workspace_id", workspaceIds);
  const nameMap = new Map<string, string>(
    (workspaces ?? []).map(w => [w.workspace_id, w.workspace_name ?? w.workspace_id]),
  );

  const currentMonth = new Date();
  currentMonth.setDate(1);
  currentMonth.setHours(0, 0, 0, 0);
  const monthStr = currentMonth.toISOString().slice(0, 10); // YYYY-MM-DD

  for (const profile of profiles) {
    result.scanned++;
    const wid  = profile.workspace_id;
    const name = nameMap.get(wid) ?? wid;
    try {
      // 1. Compute cost snapshot
      const breakdown = await computeClientMonthlyCost(wid, currentMonth);

      // 2. Store snapshot
      await upsertClientMonthlyCost(breakdown);
      result.updated++;

      // 3. Generate / refresh alerts (inserts into accountsmind_alerts)
      await generateAccountsMindAlerts(wid, breakdown, name);

      // 4. Query the critical open alerts that were just generated / already exist
      const { data: criticalAlerts } = await sb
        .from("accountsmind_alerts")
        .select("id, alert_type, title, message")
        .eq("workspace_id", wid)
        .eq("severity", "critical")
        .eq("status", "open");

      result.alertsGenerated += (criticalAlerts ?? []).length;

      // 5. Post to HiveMind tasks (deduplicated)
      for (const alert of criticalAlerts ?? []) {
        const { data: existing } = await sb
          .from("hivemind_tasks")
          .select("id")
          .eq("workspace_id", wid)
          .eq("trigger_type", "accountsmind_alert")
          .eq("entity_id", alert.alert_type)
          .eq("status", "open")
          .maybeSingle();

        if (!existing) {
          await sb.from("hivemind_tasks").insert({
            workspace_id:     wid,
            trigger_type:     "accountsmind_alert",
            entity_id:        alert.alert_type,
            entity_type:      "finance",
            title:            alert.title,
            description:      alert.message,
            suggested_action: "Review client billing profile and cost breakdown in AccountsMind.",
            priority:         "high",
            status:           "open",
          });
          result.hivemindTasksPosted++;
        }
      }

      // 6. Post GrowthMind recommendation if this workspace is loss-making
      if (breakdown.grossMarginPercent < 0 && breakdown.monthlyChargeCents > 0) {
        const { data: existingRec } = await sb
          .from("growthmind_recommendations")
          .select("id")
          .eq("workspace_id", wid)
          .eq("category", "profitability")
          .eq("is_dismissed", false)
          .maybeSingle();

        if (!existingRec) {
          await sb.from("growthmind_recommendations").insert({
            workspace_id: wid,
            category:     "profitability",
            priority:     "critical",
            problem:      `${name} is currently loss-making (margin: ${breakdown.grossMarginPercent.toFixed(1)}%).`,
            impact:       "Every pound spent on growth campaigns increases net losses.",
            fix:          "Pause new growth spend, review billing profile, and increase the monthly charge before running further campaigns.",
            action_href:  `/admin/accounts/workspace/${wid}`,
            action_label: "Review in AccountsMind",
            is_dismissed: false,
            refreshed_at: new Date().toISOString(),
          });
        }
      }
    } catch (e: any) {
      result.failed.push({ workspaceId: wid, error: e?.message ?? String(e) });
    }
  }

  return result;
}
