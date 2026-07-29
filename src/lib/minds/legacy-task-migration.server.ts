/**
 * Legacy shallow-task migration engine — Task #490 (section 20).
 *
 * Classifies existing shallow hivemind_tasks rows (created before the
 * intelligence-packet quality gate: readiness_state IS NULL AND
 * intelligence_packet IS NULL) into seven classes and migrates them:
 *
 *  - convertible      → upgraded to a packet-backed task built ONLY from the
 *                       row's own real fields (never invented evidence);
 *                       NEVER made executable, never auto-executed.
 *  - missing_context  → labelled; needs human clarification.
 *  - duplicate        → labelled; a newer/other row covers the same
 *                       (trigger_type, entity) pair.
 *  - superseded       → labelled; a packet-backed row now covers it.
 *  - obsolete         → disabled (status → dismissed); stale and inactionable.
 *  - human_task       → labelled Human Task (manual reminders keep working).
 *  - invalid          → disabled (status → dismissed); unusable rows.
 *
 * Safety rules:
 *  - WBAH workspace is hard-excluded from ALL migration (its rows are never
 *    converted into anything that could generate contact).
 *  - Batch-safe & idempotent: bounded limit; rows already carrying
 *    metadata.legacy_migration are skipped.
 *  - Conversion NEVER sets action_kind/task_category=executable and never
 *    changes a task's status to anything runnable.
 */
import {
  buildIntelligencePacket,
  evidenceItem,
} from "./intelligence-packet.server";
import { validateUniversalMindIntelligencePacket } from "./intelligence-packet.shared";

type Sb = any;

export const LEGACY_TASK_CLASSES = [
  "convertible",
  "missing_context",
  "duplicate",
  "superseded",
  "obsolete",
  "human_task",
  "invalid",
] as const;
export type LegacyTaskClass = (typeof LEGACY_TASK_CLASSES)[number];

export interface LegacyClassification {
  taskId: string;
  title: string;
  klass: LegacyTaskClass;
  reason: string;
}

const OPEN_STATUSES = new Set(["suggested", "accepted", "in_progress"]);
const STALE_DAYS = 90;

/**
 * Deterministic classifier — pure decision rules over the row set, no AI.
 * Rows are classified in priority order: invalid → human_task → duplicate →
 * superseded → obsolete → missing_context → convertible.
 */
export function classifyLegacyTaskRows(rows: Array<Record<string, any>>): LegacyClassification[] {
  const out: LegacyClassification[] = [];
  const now = Date.now();

  // Pair index for duplicate detection among the legacy rows themselves
  // (keep the NEWEST row of each open (trigger_type, entity) pair).
  const newestByPair = new Map<string, string>();
  for (const row of rows) {
    if (!OPEN_STATUSES.has(String(row.status))) continue;
    if (!row.trigger_type) continue;
    // Packet-backed (modern) siblings are handled by the SUPERSEDED rule, not
    // the duplicate rule — only legacy rows compete for "newest of pair".
    if (row.intelligence_packet != null) continue;
    const key = `${row.trigger_type}::${row.entity_type ?? ""}::${row.entity_id ?? ""}`;
    const prev = newestByPair.get(key);
    if (!prev) { newestByPair.set(key, String(row.id)); continue; }
    const prevRow = rows.find((r) => String(r.id) === prev)!;
    if (String(row.created_at ?? "") > String(prevRow.created_at ?? "")) newestByPair.set(key, String(row.id));
  }

  for (const row of rows) {
    const id = String(row.id);
    const title = String(row.title ?? "").trim();
    const description = String(row.description ?? "").trim();
    const meta = (row.metadata ?? {}) as Record<string, any>;
    const status = String(row.status ?? "");
    const ageDays = row.created_at ? (now - Date.parse(String(row.created_at))) / 86400000 : null;

    // 1. Invalid: unusable rows (no title, or closed already in a broken way).
    if (!title || title.length < 3) {
      out.push({ taskId: id, title, klass: "invalid", reason: "Row has no usable title." });
      continue;
    }

    // 2. Human Task: explicit manual reminders stay human tasks.
    if (row.source === "manual" || meta.human_task === true) {
      out.push({ taskId: id, title, klass: "human_task", reason: "Human-created manual reminder — labelled, never converted." });
      continue;
    }

    // Closed rows are historical record — nothing to migrate.
    if (!OPEN_STATUSES.has(status)) {
      out.push({ taskId: id, title, klass: "obsolete", reason: `Task is already closed (status "${status}") — historical record only.` });
      continue;
    }

    // 3. Duplicate: an open newer legacy row covers the same trigger+entity.
    if (row.trigger_type) {
      const key = `${row.trigger_type}::${row.entity_type ?? ""}::${row.entity_id ?? ""}`;
      const newest = newestByPair.get(key);
      if (newest && newest !== id) {
        out.push({ taskId: id, title, klass: "duplicate", reason: `A newer open task (${newest}) covers the same trigger "${row.trigger_type}" and entity.` });
        continue;
      }
    }

    // 4. Superseded: a packet-backed sibling was passed in (rows include
    //    modern rows for comparison when the caller provides them).
    const supersededBy = rows.find((r) =>
      String(r.id) !== id &&
      r.intelligence_packet != null &&
      r.trigger_type && row.trigger_type &&
      r.trigger_type === row.trigger_type &&
      String(r.entity_id ?? "") === String(row.entity_id ?? "") &&
      OPEN_STATUSES.has(String(r.status)));
    if (supersededBy) {
      out.push({ taskId: id, title, klass: "superseded", reason: `Packet-backed task ${supersededBy.id} now covers this trigger/entity.` });
      continue;
    }

    // 5. Obsolete: stale beyond the window with no activity.
    if (ageDays != null && ageDays > STALE_DAYS) {
      out.push({ taskId: id, title, klass: "obsolete", reason: `Open for ${Math.round(ageDays)} days with no packet and no progress — stale.` });
      continue;
    }

    // 6. Missing context: not enough real information to build an honest packet.
    const hasEntity = !!row.entity_type;
    const hasSubstance = description.length >= 20 || (title.length >= 15 && hasEntity);
    if (!hasSubstance) {
      out.push({ taskId: id, title, klass: "missing_context", reason: "Too little real information (short title, no description/entity) to build an honest packet — needs clarification." });
      continue;
    }

    // 7. Convertible.
    out.push({ taskId: id, title, klass: "convertible", reason: "Row carries enough of its own real context (title, description, trigger/entity) to build an honest intelligence packet." });
  }
  return out;
}

/** Load legacy rows (pre-gate) + open packet-backed rows for supersession checks. */
export async function loadLegacyTaskRows(sb: Sb, workspaceId: string, limit = 200): Promise<Array<Record<string, any>>> {
  const { data: legacy, error } = await sb.from("hivemind_tasks")
    .select("id, title, description, status, source, assigned_mind, trigger_type, entity_type, entity_id, metadata, intelligence_packet, readiness_state, created_at")
    .eq("workspace_id", workspaceId)
    .is("readiness_state", null)
    .is("intelligence_packet", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 500));
  if (error) throw new Error(error.message);
  const { data: modern } = await sb.from("hivemind_tasks")
    .select("id, title, status, trigger_type, entity_type, entity_id, intelligence_packet, created_at")
    .eq("workspace_id", workspaceId)
    .not("intelligence_packet", "is", null)
    .in("status", [...OPEN_STATUSES])
    .limit(500);
  return [...(legacy ?? []), ...(modern ?? [])];
}

export async function classifyLegacyTasks(sb: Sb, workspaceId: string, opts: { limit?: number } = {}): Promise<{
  classifications: LegacyClassification[];
  counts: Record<LegacyTaskClass, number>;
}> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const rows = await loadLegacyTaskRows(sb, workspaceId, opts.limit ?? 200);
  const legacyOnly = rows.filter((r) => r.intelligence_packet == null && r.readiness_state == null)
    // Idempotency: skip rows a previous migration run already handled.
    .filter((r) => !(r.metadata as any)?.legacy_migration);
  const classifications = classifyLegacyTaskRows(
    // Classifier sees modern rows too (for supersession) but only reports legacy ones.
    rows,
  ).filter((c) => legacyOnly.some((r) => String(r.id) === c.taskId));
  const counts = Object.fromEntries(LEGACY_TASK_CLASSES.map((k) => [k, 0])) as Record<LegacyTaskClass, number>;
  for (const c of classifications) counts[c.klass]++;
  return { classifications, counts };
}

/** Build an honest packet for a convertible legacy row from its OWN fields only. */
export function buildLegacyConversionPacket(row: Record<string, any>) {
  const title = String(row.title ?? "").trim();
  const description = String(row.description ?? "").trim();
  const packet = buildIntelligencePacket({
    mind: String(row.assigned_mind ?? "hivemind"),
    objective: title.length >= 10 ? title : `${title} — ${description}`.slice(0, 200),
    intentSource: "legacy_migration:convert",
    instruction: description || null,
    targets: [{
      domain: "general",
      entity_type: String(row.entity_type ?? "unknown"),
      entity_id: row.entity_id != null ? String(row.entity_id) : null,
      entity_name: null,
      resolved: !!row.entity_type,
      resolution_note: row.entity_type ? null : "Legacy row carried no entity reference.",
    }],
    evidence: [
      evidenceItem("hivemind_tasks",
        `Legacy task created ${row.created_at ?? "unknown"} via ${row.source ?? "unknown source"}${row.trigger_type ? ` (trigger: ${row.trigger_type})` : ""}: ${description || title}`,
        { legacy_task_id: String(row.id), trigger_type: row.trigger_type ?? null }),
    ],
    diagnosis: description.length >= 10
      ? description
      : `Legacy task "${title}" pre-dates the intelligence-packet standard; its original context is limited to the recorded title/trigger.`,
    planSteps: [
      { title: "Review migrated context", detail: "Confirm the legacy context still applies before acting." },
      { title: "Act or dismiss", detail: "Complete the underlying work manually or dismiss if no longer relevant." },
    ],
    deliverables: ["Reviewed decision on the migrated legacy task"],
    successCriteria: ["Task is completed or explicitly dismissed with a reason"],
    limitations: [
      "Migrated from a pre-standard shallow task — evidence is limited to the original row's own fields; nothing was invented.",
      "Never executable: migration cannot grant execution rights.",
    ],
    approvalScope: { kind: "review", summary: `Review the migrated legacy task "${title}".`, sensitive: false },
  });
  return packet;
}

export interface MigrateLegacyResult {
  scanned: number;
  converted: number;
  labelled: number;
  disabled: number;
  counts: Record<LegacyTaskClass, number>;
  details: LegacyClassification[];
}

export async function migrateLegacyTasks(sb: Sb, workspaceId: string, opts: { limit?: number } = {}): Promise<MigrateLegacyResult> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);

  const rows = await loadLegacyTaskRows(sb, workspaceId, opts.limit ?? 200);
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const { classifications, counts } = await classifyLegacyTasks(sb, workspaceId, opts);

  const nowIso = new Date().toISOString();
  let converted = 0, labelled = 0, disabled = 0;

  for (const c of classifications) {
    const row = byId.get(c.taskId);
    if (!row) continue;
    const migrationTag = { class: c.klass, reason: c.reason, at: nowIso };
    const baseMeta = { ...((row.metadata as any) ?? {}), legacy_migration: migrationTag };

    let patch: Record<string, any>;
    if (c.klass === "convertible") {
      const packet = buildLegacyConversionPacket(row);
      const v = validateUniversalMindIntelligencePacket(packet);
      patch = {
        metadata: { ...baseMeta, task_class: "informational" },
        intelligence_packet: packet,
        readiness_state: v.readiness,
        packet_version: packet.version,
        // Hard rule: migration NEVER creates executable work.
        task_category: "informational",
        action_kind: null,
        execution_status: null,
        updated_at: nowIso,
      };
      converted++;
    } else if (c.klass === "human_task") {
      patch = { metadata: { ...baseMeta, human_task: true, task_class: "human_task" }, task_category: "informational", action_kind: null, updated_at: nowIso };
      labelled++;
    } else if (
      c.klass === "obsolete" || c.klass === "invalid" ||
      c.klass === "duplicate" || c.klass === "superseded"
    ) {
      // Dismiss (with the classification label preserved in metadata) so stale
      // duplicate/superseded/obsolete rows stop appearing as open work.
      const isOpen = OPEN_STATUSES.has(String(row.status));
      patch = { metadata: baseMeta, ...(isOpen ? { status: "dismissed" } : {}), updated_at: nowIso };
      disabled++;
    } else {
      // missing_context → label only (a human must supply the missing detail).
      patch = { metadata: baseMeta, updated_at: nowIso };
      labelled++;
    }

    const { error } = await sb.from("hivemind_tasks")
      .update(patch)
      .eq("id", c.taskId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`Legacy migration failed on task ${c.taskId}: ${error.message}`);
  }

  return { scanned: classifications.length, converted, labelled, disabled, counts, details: classifications };
}
