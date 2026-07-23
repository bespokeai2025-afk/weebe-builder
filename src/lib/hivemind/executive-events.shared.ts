/**
 * HiveMind Executive OS — unified executive event stream (Stage 1).
 *
 * Pure sb-injected functions (like notification-engine.shared) so any server
 * context — normal routes, webhook processors, Vite-plugin ticks — can publish
 * without alias-import problems.
 *
 * INVARIANTS (do not weaken):
 *   • publishExecutiveEvent NEVER throws — host paths (webhooks, lead capture,
 *     bookings) can never fail because of the event stream.
 *   • Every write is scoped by workspace_id.
 *   • Dedup is enforced by the DB unique index (workspace_id, dedup_key) —
 *     duplicate publishes are silent no-ops.
 *   • Writes are service-role only (RLS grants members SELECT only).
 */

type Sb = any;

export type ExecEventSeverity = "info" | "warning" | "critical";
export type ExecEventClassification =
  | "informational"
  | "briefing"
  | "recommendation_candidate"
  | "task_candidate"
  | "warning"
  | "critical";

/** Catalog of known executive event types with deterministic defaults. */
export const EXEC_EVENT_TYPES: Record<
  string,
  { severity: ExecEventSeverity; classification: ExecEventClassification }
> = {
  // Leads / CRM
  lead_created:              { severity: "info",     classification: "briefing" },
  lead_qualified:            { severity: "info",     classification: "briefing" },
  lead_stale:                { severity: "warning",  classification: "task_candidate" },
  // Calls
  call_completed:            { severity: "info",     classification: "informational" },
  call_positive:             { severity: "info",     classification: "briefing" },
  call_failed:               { severity: "warning",  classification: "warning" },
  // Bookings
  booking_created:           { severity: "info",     classification: "briefing" },
  booking_cancelled:         { severity: "warning",  classification: "task_candidate" },
  booking_missed:            { severity: "warning",  classification: "task_candidate" },
  // Follow-ups / email
  followup_failed:           { severity: "warning",  classification: "task_candidate" },
  email_delivery_failed:     { severity: "warning",  classification: "warning" },
  // Signups / requests
  signup_request:            { severity: "info",     classification: "briefing" },
  // Executives
  growthmind_recommendation: { severity: "info",     classification: "recommendation_candidate" },
  systemmind_incident:       { severity: "warning",  classification: "warning" },
  accountsmind_warning:      { severity: "warning",  classification: "warning" },
  // Operations
  workflow_failed:           { severity: "warning",  classification: "task_candidate" },
  campaign_failed:           { severity: "critical", classification: "critical" },
  campaign_completed:        { severity: "info",     classification: "briefing" },
  integration_disconnected:  { severity: "warning",  classification: "task_candidate" },
  provider_error:            { severity: "critical", classification: "critical" },
  // Learning loop
  action_outcome:            { severity: "info",     classification: "informational" },
};

export interface PublishExecutiveEventInput {
  workspaceId: string;
  eventType: string;
  /** Which subsystem produced the event, e.g. "leads", "retell", "calendar". */
  sourceSystem: string;
  title: string;
  summary?: string | null;
  severity?: ExecEventSeverity;
  entityType?: string | null;
  entityId?: string | null;
  /**
   * Uniqueness key. When omitted, defaults to
   * `eventType:entityType:entityId` (or `eventType:<utc-day>` without an
   * entity). Same workspace + dedup key can only ever create ONE row.
   */
  dedupKey?: string | null;
  correlationKey?: string | null;
  /** Structured supporting facts — counts, ids, provider payloads (scrubbed). */
  evidence?: Record<string, unknown> | null;
  occurredAt?: string | null;
}

export interface PublishResult {
  ok: boolean;
  deduped: boolean;
  id?: string;
}

function defaultDedupKey(input: PublishExecutiveEventInput): string {
  if (input.entityType && input.entityId) {
    return `${input.eventType}:${input.entityType}:${input.entityId}`;
  }
  const day = new Date().toISOString().slice(0, 10);
  return `${input.eventType}:${day}`;
}

/**
 * Publish one executive event. NEVER throws. Duplicate dedup keys are
 * silently ignored (DB unique index + ignoreDuplicates upsert).
 */
export async function publishExecutiveEvent(
  sb: Sb,
  input: PublishExecutiveEventInput,
): Promise<PublishResult> {
  try {
    if (!input.workspaceId || !input.eventType || !input.sourceSystem || !input.title) {
      return { ok: false, deduped: false };
    }
    const catalog = EXEC_EVENT_TYPES[input.eventType];
    const dedupKey = (input.dedupKey ?? defaultDedupKey(input)).slice(0, 500);

    const row = {
      workspace_id:    input.workspaceId,
      event_type:      input.eventType.slice(0, 100),
      source_system:   input.sourceSystem.slice(0, 100),
      severity:        input.severity ?? catalog?.severity ?? "info",
      title:           input.title.slice(0, 500),
      summary:         input.summary?.slice(0, 4000) ?? null,
      entity_type:     input.entityType?.slice(0, 100) ?? null,
      entity_id:       input.entityId?.slice(0, 200) ?? null,
      dedup_key:       dedupKey,
      correlation_key: input.correlationKey?.slice(0, 500) ?? null,
      evidence:        input.evidence ?? {},
      occurred_at:     input.occurredAt ?? new Date().toISOString(),
      processing_status: "pending",
    };

    const { data, error } = await sb
      .from("hivemind_executive_events")
      .upsert(row, { onConflict: "workspace_id,dedup_key", ignoreDuplicates: true })
      .select("id");
    if (error) {
      console.warn("[exec-events] publish failed (non-fatal):", error.message);
      return { ok: false, deduped: false };
    }
    // ignoreDuplicates returns [] when the row already existed.
    if (!data || data.length === 0) return { ok: true, deduped: true };
    return { ok: true, deduped: false, id: data[0].id as string };
  } catch (err: any) {
    console.warn("[exec-events] publish failed (non-fatal):", err?.message ?? err);
    return { ok: false, deduped: false };
  }
}

/**
 * Deterministic classifier — consumes pending events and stamps a
 * classification. Rules only (no AI): catalog classification, upgraded by
 * severity (critical severity always classifies as critical; warning
 * severity never classifies below warning unless it is a task candidate).
 */
export function classifyEvent(eventType: string, severity: string): ExecEventClassification {
  const cat = EXEC_EVENT_TYPES[eventType]?.classification;
  if (severity === "critical") return "critical";
  if (cat) {
    if (severity === "warning" && (cat === "informational" || cat === "briefing")) return "warning";
    return cat;
  }
  if (severity === "warning") return "warning";
  return "informational";
}

export interface ClassifyResult {
  scanned: number;
  classified: number;
  failed: number;
}

/** Classify up to `limit` pending events. NEVER throws. */
export async function classifyPendingExecutiveEvents(
  sb: Sb,
  limit = 200,
): Promise<ClassifyResult> {
  const out: ClassifyResult = { scanned: 0, classified: 0, failed: 0 };
  try {
    const { data: rows, error } = await sb
      .from("hivemind_executive_events")
      .select("id, event_type, severity")
      .eq("processing_status", "pending")
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error || !rows?.length) return out;

    const now = new Date().toISOString();
    // Group ids by classification so we update in a few batched statements.
    const byClass = new Map<string, string[]>();
    for (const r of rows) {
      out.scanned++;
      const cls = classifyEvent(String(r.event_type), String(r.severity));
      const arr = byClass.get(cls) ?? [];
      arr.push(r.id);
      byClass.set(cls, arr);
    }
    for (const [cls, ids] of byClass) {
      const { error: upErr } = await sb
        .from("hivemind_executive_events")
        .update({ processing_status: "classified", classification: cls, classified_at: now })
        .in("id", ids)
        .eq("processing_status", "pending");
      if (upErr) {
        out.failed += ids.length;
        console.warn("[exec-events] classify update failed:", upErr.message);
      } else {
        out.classified += ids.length;
      }
    }
  } catch (err: any) {
    console.warn("[exec-events] classify failed (non-fatal):", err?.message ?? err);
  }
  return out;
}
