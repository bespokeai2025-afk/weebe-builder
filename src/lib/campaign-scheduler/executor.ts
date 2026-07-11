/**
 * Campaign Scheduler — core executor.
 *
 * Fetches all active __sched_v1__ campaigns across all workspaces,
 * checks whether each is due based on callTime + timezone, and triggers
 * Retell outbound calls for matching leads / data records.
 *
 * Designed to be called both from the Vite dev-server plugin (every 5 min)
 * and from the /api/public/campaign-executor HTTP endpoint (hit by pg_cron).
 */

import { createClient } from "@supabase/supabase-js";

const MARKER = "__sched_v1__";
const MAX_RECORDS_PER_RUN = 200;
const MAX_CONCURRENT_CALLS = 20;

/**
 * Concurrency pool — runs `fn` over all `items` with at most `limit` promises
 * in-flight simultaneously.  Workers pull from a shared queue so the pool
 * stays full until every item is processed.
 *
 * JS is single-threaded: queue.shift() and counter mutations are safe without
 * locks even while multiple workers are "concurrent" via await-interleaving.
 */
async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const queue = items.map((item, i) => ({ item, i }));

  async function worker(): Promise<void> {
    while (true) {
      const next = queue.shift();
      if (!next) break;
      await fn(next.item, next.i);
    }
  }

  const poolSize = Math.min(limit, items.length);
  if (poolSize === 0) return;
  await Promise.all(Array.from({ length: poolSize }, worker));
}

export type PageType = "data" | "qualified" | "leads";

export type ScheduleConfig = {
  pageType: PageType;
  leadStatusFilter: string | null;
  callTime: string;
  timezone: string;
  callFrequency: "daily" | "custom";
  intervalDays: number;
  voicemailEnabled: boolean;
  lastRunDate?: string;
};

export type CampaignRunResult = {
  campaignId: string;
  campaignName: string;
  skipped: boolean;
  skipReason?: string;
  placed: number;
  failed: number;
};

function parseConfig(description: string | null): ScheduleConfig | null {
  if (!description?.startsWith(MARKER)) return null;
  try {
    return JSON.parse(description.slice(MARKER.length)) as ScheduleConfig;
  } catch {
    return null;
  }
}

function encodeConfig(cfg: ScheduleConfig): string {
  return MARKER + JSON.stringify(cfg);
}

function getTodayInTimezone(tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getLocalHHMM(tz: string): { h: number; m: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return { h, m };
  } catch {
    const now = new Date();
    return { h: now.getUTCHours(), m: now.getUTCMinutes() };
  }
}

function isDue(cfg: ScheduleConfig): boolean {
  const { h: lh, m: lm } = getLocalHHMM(cfg.timezone);
  const [ch, cm] = cfg.callTime.split(":").map(Number);
  const cfgMinutes = (ch || 0) * 60 + (cm || 0);
  const nowMinutes = lh * 60 + lm;

  if (Math.abs(nowMinutes - cfgMinutes) >= 5) return false;

  const today = getTodayInTimezone(cfg.timezone);
  if (!cfg.lastRunDate) return true;

  if (cfg.callFrequency === "daily") {
    return cfg.lastRunDate !== today;
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const lastDate = new Date(cfg.lastRunDate + "T00:00:00Z").getTime();
  const todayDate = new Date(today + "T00:00:00Z").getTime();
  const daysDiff = Math.round((todayDate - lastDate) / msPerDay);
  return daysDiff >= Math.max(1, cfg.intervalDays ?? 1);
}

export async function runCampaignTick(opts?: {
  supabaseUrl?: string;
  serviceRoleKey?: string;
  retellApiKey?: string;
}): Promise<{ results: CampaignRunResult[]; error?: string }> {
  const supabaseUrl = opts?.supabaseUrl ?? process.env.VITE_SUPABASE_URL;
  const serviceKey =
    opts?.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const platformRetellKey =
    opts?.retellApiKey ?? process.env.RETELL_API_KEY ?? "";

  if (!supabaseUrl || !serviceKey) {
    return { results: [], error: "Missing SUPABASE env vars" };
  }

  const sb = createClient(supabaseUrl, serviceKey) as any;

  const { data: campaigns, error: fetchErr } = await sb
    .from("campaigns")
    .select("id, name, description, status, agent_id, workspace_id")
    .eq("status", "active")
    .like("description", `${MARKER}%`);

  if (fetchErr) {
    return { results: [], error: `Failed to fetch campaigns: ${fetchErr.message}` };
  }

  if (!campaigns?.length) {
    return { results: [] };
  }

  const results: CampaignRunResult[] = [];

  for (const campaign of campaigns) {
    const base: CampaignRunResult = {
      campaignId: campaign.id,
      campaignName: campaign.name,
      skipped: false,
      placed: 0,
      failed: 0,
    };

    const cfg = parseConfig(campaign.description);
    if (!cfg) {
      results.push({ ...base, skipped: true, skipReason: "invalid config" });
      continue;
    }

    if (!isDue(cfg)) {
      results.push({ ...base, skipped: true, skipReason: "not due" });
      continue;
    }

    if (!campaign.agent_id) {
      results.push({ ...base, skipped: true, skipReason: "no agent assigned" });
      continue;
    }

    const today = getTodayInTimezone(cfg.timezone);
    const updatedCfg: ScheduleConfig = { ...cfg, lastRunDate: today };
    await sb
      .from("campaigns")
      .update({ description: encodeConfig(updatedCfg) })
      .eq("id", campaign.id);

    const { data: agent } = await sb
      .from("agents")
      .select("id, retell_agent_id, name, settings, inbound_phone_number")
      .eq("id", campaign.agent_id)
      .maybeSingle();

    if (!agent) {
      results.push({ ...base, skipped: true, skipReason: "agent not found" });
      continue;
    }

    const settings = (agent.settings ?? {}) as Record<string, unknown>;
    const deployedRetellAgentId =
      (settings.deployedRetellAgentId as string | undefined) ?? null;
    const retellAgentId = deployedRetellAgentId ?? agent.retell_agent_id ?? null;
    const fromNumber =
      (settings.phoneNumber as string | undefined) ??
      agent.inbound_phone_number ??
      null;

    if (!retellAgentId) {
      results.push({ ...base, skipped: true, skipReason: "agent has no Retell ID" });
      continue;
    }
    if (!fromNumber) {
      results.push({ ...base, skipped: true, skipReason: "agent has no phone number" });
      continue;
    }

    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", campaign.workspace_id)
      .maybeSingle();
    const clientRetellKey = (wsSettings?.retell_workspace_id as string | undefined)?.trim();
    const effectiveKey = deployedRetellAgentId
      ? (clientRetellKey || platformRetellKey)
      : platformRetellKey;

    if (!effectiveKey) {
      results.push({ ...base, skipped: true, skipReason: "no Retell API key" });
      continue;
    }

    let records: Array<{ id: string; phone: string; tableSource: "data_records" | "leads" }> = [];

    if (cfg.pageType === "data") {
      let q = sb
        .from("data_records")
        .select("id, mobile_number")
        .eq("workspace_id", campaign.workspace_id)
        .not("mobile_number", "is", null)
        .limit(MAX_RECORDS_PER_RUN);
      if (cfg.leadStatusFilter) {
        q = q.eq("call_status", cfg.leadStatusFilter);
      }
      const { data } = await q;
      records = (data ?? []).map((r: any) => ({
        id: r.id,
        phone: r.mobile_number as string,
        tableSource: "data_records" as const,
      }));
    } else if (cfg.pageType === "leads") {
      let q = sb
        .from("leads")
        .select("id, phone")
        .eq("workspace_id", campaign.workspace_id)
        .not("phone", "is", null)
        .limit(MAX_RECORDS_PER_RUN);
      if (cfg.leadStatusFilter) {
        q = q.eq("status", cfg.leadStatusFilter);
      }
      const { data } = await q;
      records = (data ?? [])
        .filter((r: any) => r.phone)
        .map((r: any) => ({ id: r.id, phone: r.phone as string, tableSource: "leads" as const }));
    } else if (cfg.pageType === "qualified") {
      let q = sb
        .from("leads")
        .select("id, phone")
        .eq("workspace_id", campaign.workspace_id)
        .not("phone", "is", null)
        .limit(MAX_RECORDS_PER_RUN);
      if (cfg.leadStatusFilter) {
        q = q.eq("qualification_status", cfg.leadStatusFilter);
      }
      const { data } = await q;
      records = (data ?? [])
        .filter((r: any) => r.phone)
        .map((r: any) => ({ id: r.id, phone: r.phone as string, tableSource: "leads" as const }));
    }

    const total = records.length;
    console.log(
      `[campaign-scheduler] "${campaign.name}" — ${total} record(s) to call` +
        ` (pool=${Math.min(MAX_CONCURRENT_CALLS, total)} concurrent)`,
    );

    // Start of the current UTC day — used to enforce the standard
    // 3-calls-per-phone-per-UTC-day guardrail on lead campaign re-runs, shared
    // with the auto-call-on-new-lead pipeline (auto-call.server.ts).
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    const todayUtcIso = todayUtc.toISOString();

    let placed = 0;
    let failed = 0;
    let skipped = 0;

    await withConcurrency(records, MAX_CONCURRENT_CALLS, async (record) => {
      try {
        // Lead / qualified campaigns share the platform daily call cap so
        // repeated runs never dial the same number more than 3x per UTC day.
        if (record.tableSource === "leads") {
          const { count: attemptsToday } = await sb
            .from("calls")
            .select("id", { count: "exact", head: true })
            .eq("workspace_id", campaign.workspace_id)
            .eq("to_number", record.phone)
            .gte("created_at", todayUtcIso);
          if ((attemptsToday ?? 0) >= 3) {
            skipped++;
            return;
          }
        }

        const payload = {
          from_number: fromNumber,
          to_number: record.phone,
          override_agent_id: retellAgentId,
          metadata: {
            campaign_id: campaign.id,
            workspace_id: campaign.workspace_id,
          },
        };

        const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${effectiveKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          placed++;
          if (record.tableSource === "leads") {
            // Reflect the placed call on the lead (status changes accordingly)
            // and record it in `calls` so the shared daily cap + the webhook's
            // phone-match lifecycle both see this attempt.
            const call = await res.json().catch(() => null);
            const now = new Date().toISOString();
            await sb
              .from("leads")
              .update({ status: "calling", updated_at: now })
              .eq("id", record.id)
              .eq("workspace_id", campaign.workspace_id);
            await sb.from("calls").insert({
              workspace_id: campaign.workspace_id,
              retell_call_id: call?.call_id ?? null,
              agent_id: retellAgentId,
              agent_name: agent.name ?? null,
              from_number: fromNumber,
              to_number: record.phone,
              call_type: "outbound",
              call_status: "initiated",
              lead_id: record.id,
            });
          } else if (record.tableSource === "data_records") {
            await sb
              .from("data_records")
              .update({
                call_status: "calling",
                assigned_agent_id: campaign.agent_id,
              })
              .eq("id", record.id)
              .eq("workspace_id", campaign.workspace_id);
          }
        } else {
          failed++;
          const errText = await res.text().catch(() => res.statusText);
          console.error(
            `[campaign-scheduler] Call failed for ${record.phone}: ${res.status} ${errText}`,
          );
          if (record.tableSource === "data_records") {
            await sb
              .from("data_records")
              .update({ call_status: "failed" })
              .eq("id", record.id)
              .eq("workspace_id", campaign.workspace_id);
          }
        }
      } catch (e: any) {
        failed++;
        console.error(
          `[campaign-scheduler] Error calling ${record.phone}:`,
          e?.message ?? e,
        );
      }
    });

    console.log(
      `[campaign-scheduler] "${campaign.name}" done — placed: ${placed}, failed: ${failed}` +
        (skipped > 0 ? `, skipped(cap): ${skipped}` : "") +
        (failed > 0 ? ` (${total - placed - failed - skipped} still queued)` : ""),
    );

    results.push({ ...base, placed, failed });
  }

  return { results };
}
