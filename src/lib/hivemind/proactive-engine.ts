// ── Proactive HiveMind Engine ─────────────────────────────────────────────────
// Runs on the campaign-executor cron tick (every 5 min, throttled internally).
// Performs DNA discovery + daily briefing generation for all active workspaces.
// Nothing auto-executes — all outputs go to approval queues.

import { createClient } from "@supabase/supabase-js";

const DNA_REFRESH_HOURS  = 6;   // run DNA discovery at most every 6h per workspace
const BRIEFING_HOUR      = 7;   // generate daily briefing if not already done today

export type ProactiveTick = {
  workspacesScanned: number;
  dnaRefreshed:      number;
  briefingsGenerated: number;
  errors:            number;
};

export async function runProactiveTick(): Promise<ProactiveTick> {
  const supabaseUrl  = process.env.SUPABASE_URL  ?? process.env.VITE_SUPABASE_URL  ?? "";
  const serviceKey   = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return { workspacesScanned: 0, dnaRefreshed: 0, briefingsGenerated: 0, errors: 0 };

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Fetch all workspaces with an OpenAI key configured
  const { data: workspaces } = await sb
    .from("workspace_settings")
    .select("workspace_id, openai_api_key, hivemind_mode")
    .not("openai_api_key", "is", null)
    .neq("openai_api_key", "");

  if (!workspaces?.length) return { workspacesScanned: 0, dnaRefreshed: 0, briefingsGenerated: 0, errors: 0 };

  const now = new Date();
  let dnaRefreshed = 0;
  let briefingsGenerated = 0;
  let errors = 0;

  await Promise.all(
    workspaces.map(async (ws: any) => {
      const workspaceId = ws.workspace_id;
      const apiKey      = ws.openai_api_key as string;
      try {
        // ── DNA Discovery ──────────────────────────────────────────────────────
        const { data: dnaRow } = await sb
          .from("growthmind_business_dna")
          .select("last_discovery_at")
          .eq("workspace_id", workspaceId)
          .single();

        const lastDiscovery = dnaRow?.last_discovery_at ? new Date(dnaRow.last_discovery_at) : null;
        const hoursSince    = lastDiscovery
          ? (now.getTime() - lastDiscovery.getTime()) / 3_600_000
          : Infinity;

        if (hoursSince >= DNA_REFRESH_HOURS) {
          try {
            const { runDnaDiscovery } = await import("./dna-discovery.server");
            await runDnaDiscovery(workspaceId, apiKey);
            dnaRefreshed++;
          } catch (e: any) {
            console.error(`[proactive-engine] DNA discovery failed for ws ${workspaceId}:`, e?.message);
            errors++;
          }
        }

        // ── Daily Briefing ─────────────────────────────────────────────────────
        // Only generate if current hour is past BRIEFING_HOUR and no briefing exists today
        if (now.getHours() >= BRIEFING_HOUR) {
          const todayStart = new Date(now);
          todayStart.setHours(0, 0, 0, 0);

          const { data: existing } = await sb
            .from("hivemind_briefings")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("type", "daily")
            .gte("created_at", todayStart.toISOString())
            .limit(1);

          if (!existing?.length) {
            try {
              const { generateBriefing } = await import("./briefing-generator.server");
              await generateBriefing(workspaceId, apiKey, "daily", "scheduler");
              briefingsGenerated++;
            } catch (e: any) {
              console.error(`[proactive-engine] Briefing generation failed for ws ${workspaceId}:`, e?.message);
              errors++;
            }
          }
        }

        // ── Weekly Briefing (Sundays) ──────────────────────────────────────────
        if (now.getDay() === 0 && now.getHours() >= BRIEFING_HOUR) {
          const weekStart = new Date(now);
          weekStart.setHours(0, 0, 0, 0);
          const { data: existingWeekly } = await sb
            .from("hivemind_briefings")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("type", "weekly")
            .gte("created_at", weekStart.toISOString())
            .limit(1);

          if (!existingWeekly?.length) {
            try {
              const { generateBriefing } = await import("./briefing-generator.server");
              await generateBriefing(workspaceId, apiKey, "weekly", "scheduler");
              briefingsGenerated++;
            } catch (e: any) {
              console.error(`[proactive-engine] Weekly briefing failed for ws ${workspaceId}:`, e?.message);
              errors++;
            }
          }
        }

        // ── Monthly Briefing (1st of month) ───────────────────────────────────
        if (now.getDate() === 1 && now.getHours() >= BRIEFING_HOUR) {
          const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
          const { data: existingMonthly } = await sb
            .from("hivemind_briefings")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("type", "monthly")
            .gte("created_at", monthStart.toISOString())
            .limit(1);

          if (!existingMonthly?.length) {
            try {
              const { generateBriefing } = await import("./briefing-generator.server");
              await generateBriefing(workspaceId, apiKey, "monthly", "scheduler");
              briefingsGenerated++;
            } catch (e: any) {
              console.error(`[proactive-engine] Monthly briefing failed for ws ${workspaceId}:`, e?.message);
              errors++;
            }
          }
        }

      } catch (e: any) {
        console.error(`[proactive-engine] Workspace ${workspaceId} error:`, e?.message);
        errors++;
      }
    }),
  );

  console.log(
    `[proactive-engine] workspaces=${workspaces.length} dna=${dnaRefreshed} briefings=${briefingsGenerated} errors=${errors}`,
  );

  return {
    workspacesScanned:  workspaces.length,
    dnaRefreshed,
    briefingsGenerated,
    errors,
  };
}
