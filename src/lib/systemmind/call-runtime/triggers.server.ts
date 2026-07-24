// ── SystemMind call runtime: trigger engine ──────────────────────────────────
// Persisted trigger definitions (systemmind_call_triggers) with:
//   • plain-English summary generation
//   • eligibility conditions, calling windows, daily caps, dedup windows
//   • tick-based evaluation for lead-based + scheduled + delay triggers
// Writes are server-only. Trigger evaluation NEVER throws out of the tick.

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import { enqueueCall } from "./queue.server";

const sb = supabaseAdmin as any;

export type TriggerType =
  | "manual" | "crm_lead_created" | "crm_lead_changed" | "webee_lead_created"
  | "webee_lead_status" | "csv_upload" | "webform" | "scheduled"
  | "delay_after_creation" | "callback" | "api_webhook";

export interface TriggerConditions {
  status_in?: string[];
  source_in?: string[];
  require_phone?: boolean;
  interest_in?: string[];
}

export interface CallingWindow {
  /** 0=Sunday … 6=Saturday. Empty/undefined = every day. */
  days?: number[];
  /** "09:00" (24h). */
  start?: string;
  end?: string;
  timezone?: string;
}

// ── Plain-English summary ─────────────────────────────────────────────────────

const TRIGGER_LABELS: Record<TriggerType, string> = {
  manual: "started manually",
  crm_lead_created: "a new lead appears in the CRM",
  crm_lead_changed: "a CRM lead changes",
  webee_lead_created: "a new lead is created in WEBEE",
  webee_lead_status: "a WEBEE lead changes status",
  csv_upload: "leads are uploaded via CSV",
  webform: "a webform enquiry arrives",
  scheduled: "the scheduled time arrives",
  delay_after_creation: "a delay after lead creation elapses",
  callback: "a requested callback comes due",
  api_webhook: "an external system calls the API webhook",
};

export function buildTriggerSummary(t: {
  trigger_type: string;
  conditions?: TriggerConditions | null;
  calling_window?: CallingWindow | null;
  max_attempts?: number;
  daily_cap?: number;
  schedule?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [];
  parts.push(`Calls are placed when ${TRIGGER_LABELS[t.trigger_type as TriggerType] ?? t.trigger_type}`);
  const c = t.conditions ?? {};
  if (c.source_in?.length) parts.push(`only for leads from ${c.source_in.join(", ")}`);
  if (c.status_in?.length) parts.push(`only when the lead status is ${c.status_in.join(" or ")}`);
  if (c.require_phone !== false) parts.push("only when the lead has a phone number");
  const w = t.calling_window ?? {};
  if (w.start && w.end) {
    const days = w.days?.length
      ? w.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join("/")
      : "every day";
    parts.push(`within the calling window ${w.start}–${w.end} (${w.timezone ?? "UTC"}, ${days})`);
  }
  if (t.max_attempts) parts.push(`up to ${t.max_attempts} attempts per lead`);
  if (t.daily_cap) parts.push(`capped at ${t.daily_cap} calls per day`);
  return parts.join("; ") + ".";
}

// ── Calling-window check ──────────────────────────────────────────────────────

export function isWithinCallingWindow(w: CallingWindow | null | undefined, now = new Date()): boolean {
  if (!w || (!w.start && !w.end && !w.days?.length)) return true;
  const tz = w.timezone || "UTC";
  let local: { day: number; minutes: number };
  try {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    const dayIdx = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
    local = { day: dayIdx < 0 ? now.getUTCDay() : dayIdx, minutes: hh * 60 + mm };
  } catch {
    local = { day: now.getUTCDay(), minutes: now.getUTCHours() * 60 + now.getUTCMinutes() };
  }
  if (w.days?.length && !w.days.includes(local.day)) return false;
  const toMin = (s?: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const start = toMin(w.start);
  const end = toMin(w.end);
  if (start != null && local.minutes < start) return false;
  if (end != null && local.minutes >= end) return false;
  return true;
}

// ── Eligibility ───────────────────────────────────────────────────────────────

export function leadMatchesConditions(
  lead: { phone?: string | null; status?: string | null; source?: string | null; interest_level?: string | null },
  c: TriggerConditions | null | undefined,
): { ok: boolean; reason?: string } {
  const cond = c ?? {};
  if (cond.require_phone !== false && !lead.phone?.trim()) return { ok: false, reason: "no_phone" };
  if (cond.status_in?.length && !cond.status_in.includes(lead.status ?? "")) return { ok: false, reason: "status_not_matching" };
  if (cond.source_in?.length && !cond.source_in.includes(lead.source ?? "")) return { ok: false, reason: "source_not_matching" };
  if (cond.interest_in?.length && !cond.interest_in.includes(lead.interest_level ?? "")) return { ok: false, reason: "interest_not_matching" };
  return { ok: true };
}

// ── CRUD (called by server fns) ───────────────────────────────────────────────

export async function saveCallTriggerServer(args: {
  workspaceId: string;
  userId: string | null;
  id?: string | null;
  agentId?: string | null;
  activationId?: string | null;
  name: string;
  triggerType: TriggerType;
  enabled?: boolean;
  conditions?: TriggerConditions;
  callingWindow?: CallingWindow;
  maxAttempts?: number;
  dailyCap?: number;
  retryConfig?: Record<string, unknown>;
  dedupWindowMinutes?: number;
  schedule?: Record<string, unknown>;
}) {
  assertNotWbahWorkspace(args.workspaceId);
  const row: Record<string, unknown> = {
    workspace_id: args.workspaceId,
    agent_id: args.agentId ?? null,
    activation_id: args.activationId ?? null,
    name: args.name,
    trigger_type: args.triggerType,
    enabled: args.enabled ?? false,
    conditions: args.conditions ?? {},
    calling_window: args.callingWindow ?? {},
    max_attempts: args.maxAttempts ?? 3,
    daily_cap: args.dailyCap ?? 100,
    retry_config: args.retryConfig ?? {},
    dedup_window_minutes: args.dedupWindowMinutes ?? 1440,
    schedule: args.schedule ?? {},
    updated_at: new Date().toISOString(),
  };
  row.summary = buildTriggerSummary({
    trigger_type: args.triggerType,
    conditions: args.conditions,
    calling_window: args.callingWindow,
    max_attempts: args.maxAttempts ?? 3,
    daily_cap: args.dailyCap ?? 100,
  });

  if (args.id) {
    const { data, error } = await sb
      .from("systemmind_call_triggers")
      .update(row)
      .eq("id", args.id)
      .eq("workspace_id", args.workspaceId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  row.created_by_user_id = args.userId;
  const { data, error } = await sb
    .from("systemmind_call_triggers")
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function setTriggerEnabledServer(args: { workspaceId: string; id: string; enabled: boolean }) {
  const { error } = await sb
    .from("systemmind_call_triggers")
    .update({ enabled: args.enabled, updated_at: new Date().toISOString() })
    .eq("id", args.id)
    .eq("workspace_id", args.workspaceId);
  if (error) throw new Error(error.message);
}

// ── Event hook: WEBEE lead created (call from lead-creation paths / tick) ────

export async function dispatchCallTriggersForLead(args: {
  workspaceId: string;
  leadId: string;
  eventType?: "webee_lead_created" | "webee_lead_status" | "webform" | "csv_upload" | "api_webhook";
}): Promise<{ enqueued: number }> {
  try {
    assertNotWbahWorkspace(args.workspaceId);
  } catch {
    return { enqueued: 0 };
  }
  const eventType = args.eventType ?? "webee_lead_created";
  const { data: triggers } = await sb
    .from("systemmind_call_triggers")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("enabled", true)
    .eq("trigger_type", eventType);
  if (!triggers?.length) return { enqueued: 0 };

  const { data: lead } = await sb
    .from("leads")
    .select("id, phone, full_name, status, source, interest_level")
    .eq("id", args.leadId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!lead) return { enqueued: 0 };

  let enqueued = 0;
  for (const t of triggers) {
    const match = leadMatchesConditions(lead, t.conditions);
    if (!match.ok) continue;
    const res = await enqueueCall({
      workspaceId: args.workspaceId,
      triggerId: t.id,
      activationId: t.activation_id,
      agentId: t.agent_id,
      leadId: String(lead.id),
      leadName: lead.full_name ?? "",
      phone: lead.phone ?? "",
      maxAttempts: t.max_attempts ?? 3,
      dedupKey: `${t.id}:${lead.id}`,
    });
    if (res.enqueued) enqueued++;
  }
  return { enqueued };
}

// ── Tick evaluation: lead-based sweep + scheduled + delay triggers ───────────

export async function evaluateTriggersTick(): Promise<{ evaluated: number; enqueued: number }> {
  let evaluated = 0;
  let enqueued = 0;
  const { data: triggers } = await sb
    .from("systemmind_call_triggers")
    .select("*")
    .eq("enabled", true)
    .limit(200);
  if (!triggers?.length) return { evaluated, enqueued };

  for (const t of triggers) {
    try {
      try {
        assertNotWbahWorkspace(t.workspace_id);
      } catch {
        continue;
      }
      evaluated++;
      const since = t.last_evaluated_at ?? new Date(Date.now() - 24 * 3600_000).toISOString();
      const nowIso = new Date().toISOString();

      if (
        t.trigger_type === "webee_lead_created" ||
        t.trigger_type === "webform" ||
        t.trigger_type === "csv_upload" ||
        t.trigger_type === "crm_lead_created"
      ) {
        // Sweep leads created since the last evaluation. webform/csv/crm
        // triggers narrow by lead source.
        let q = sb
          .from("leads")
          .select("id, phone, full_name, status, source, interest_level, created_at")
          .eq("workspace_id", t.workspace_id)
          .gt("created_at", since)
          .limit(200);
        if (t.trigger_type === "webform") q = q.eq("source", "webform");
        if (t.trigger_type === "csv_upload") q = q.eq("source", "csv");
        if (t.trigger_type === "crm_lead_created") q = q.eq("source", "crm");
        const { data: leads } = await q;
        for (const lead of leads ?? []) {
          if (!leadMatchesConditions(lead, t.conditions).ok) continue;
          const res = await enqueueCall({
            workspaceId: t.workspace_id,
            triggerId: t.id,
            activationId: t.activation_id,
            agentId: t.agent_id,
            leadId: String(lead.id),
            leadName: lead.full_name ?? "",
            phone: lead.phone ?? "",
            maxAttempts: t.max_attempts ?? 3,
            dedupKey: `${t.id}:${lead.id}`,
          });
          if (res.enqueued) enqueued++;
        }
      } else if (t.trigger_type === "delay_after_creation") {
        const delayMinutes = Number((t.schedule as any)?.delay_minutes ?? 60);
        const cutoff = new Date(Date.now() - delayMinutes * 60_000).toISOString();
        const { data: leads } = await sb
          .from("leads")
          .select("id, phone, full_name, status, source, interest_level, created_at")
          .eq("workspace_id", t.workspace_id)
          .gt("created_at", since)
          .lte("created_at", cutoff)
          .limit(200);
        for (const lead of leads ?? []) {
          if (!leadMatchesConditions(lead, t.conditions).ok) continue;
          const res = await enqueueCall({
            workspaceId: t.workspace_id,
            triggerId: t.id,
            activationId: t.activation_id,
            agentId: t.agent_id,
            leadId: String(lead.id),
            leadName: lead.full_name ?? "",
            phone: lead.phone ?? "",
            maxAttempts: t.max_attempts ?? 3,
            dedupKey: `${t.id}:${lead.id}`,
          });
          if (res.enqueued) enqueued++;
        }
        // Delay triggers advance the watermark only up to the cutoff so leads
        // still inside their delay period are picked up by a later tick.
        await sb
          .from("systemmind_call_triggers")
          .update({ last_evaluated_at: cutoff })
          .eq("id", t.id);
        continue;
      } else if (t.trigger_type === "scheduled") {
        // schedule: { hour: 9, minute: 0, timezone } — enqueue matching leads
        // once per day when the local time passes the scheduled slot.
        const sched = (t.schedule as any) ?? {};
        const lastRun = sched.last_run_date as string | undefined;
        const tz = sched.timezone || "UTC";
        const todayLocal = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
        const hourLocal = Number(
          new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()),
        );
        if (lastRun !== todayLocal && hourLocal >= Number(sched.hour ?? 9)) {
          const { data: leads } = await sb
            .from("leads")
            .select("id, phone, full_name, status, source, interest_level")
            .eq("workspace_id", t.workspace_id)
            .limit(Number(sched.batch_size ?? 50));
          for (const lead of leads ?? []) {
            if (!leadMatchesConditions(lead, t.conditions).ok) continue;
            const res = await enqueueCall({
              workspaceId: t.workspace_id,
              triggerId: t.id,
              activationId: t.activation_id,
              agentId: t.agent_id,
              leadId: String(lead.id),
              leadName: lead.full_name ?? "",
              phone: lead.phone ?? "",
              maxAttempts: t.max_attempts ?? 3,
              dedupKey: `${t.id}:${lead.id}:${todayLocal}`,
            });
            if (res.enqueued) enqueued++;
          }
          await sb
            .from("systemmind_call_triggers")
            .update({ schedule: { ...sched, last_run_date: todayLocal }, last_evaluated_at: nowIso })
            .eq("id", t.id);
          continue;
        }
      }
      // manual / callback / api_webhook / webee_lead_status enqueue elsewhere.
      await sb
        .from("systemmind_call_triggers")
        .update({ last_evaluated_at: nowIso })
        .eq("id", t.id);
    } catch (e) {
      console.warn("[call-triggers] evaluation failed for", t.id, e instanceof Error ? e.message : e);
    }
  }
  return { evaluated, enqueued };
}
