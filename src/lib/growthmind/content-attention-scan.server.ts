/**
 * GrowthMind Phase 5 — content attention scan.
 *
 * Detects GrowthMind items needing human attention and raises them as
 * HiveMind tasks + events (the COO surfaces them in the action centre):
 *   - social connection tokens expired / expiring within 7 days
 *   - publishing jobs that have failed
 *   - content projects stuck awaiting approval for > 48h
 *   - proposed learning patterns awaiting an accept/reject decision
 *   - high-scoring trend recommendations going stale (> 7 days untouched)
 *
 * Dedup mirrors the HiveMind scanner: no duplicate open task per
 * (trigger_type, entity_id); events deduped over the last 24h. Executive
 * events publish via the never-throw backbone.
 */

type Sb = any;

async function getAdmin(): Promise<Sb> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

interface Finding {
  trigger_type: string;
  severity:     "info" | "warning" | "critical";
  priority:     "low" | "medium" | "high";
  title:        string;
  description:  string;
  entity_type:  string;
  entity_id:    string;
  entity_name:  string | null;
  metadata?:    Record<string, unknown>;
}

export async function runContentAttentionScan(workspaceId: string): Promise<{ findings: number; newTasks: number; newEvents: number }> {
  const admin = await getAdmin();
  const now = Date.now();
  const findings: Finding[] = [];

  const in7d   = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
  const ago48h = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const ago7d  = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const ago30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [connsRes, failedJobsRes, stuckProjectsRes, patternsRes, staleTrendsRes] = await Promise.all([
    admin.from("growthmind_social_connections")
      .select("id, provider, account_type, account_name, username, status, token_expires_at")
      .eq("workspace_id", workspaceId)
      .neq("status", "disconnected"),
    admin.from("growthmind_publishing_jobs")
      .select("id, platform, status, error_message, project_id, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "failed")
      .gte("updated_at", ago30d)
      .limit(20),
    admin.from("growthmind_content_projects")
      .select("id, title, status, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "awaiting_approval")
      .lte("updated_at", ago48h)
      .limit(20),
    admin.from("growthmind_learned_patterns")
      .select("id, pattern_kind, pattern_key, insight")
      .eq("workspace_id", workspaceId)
      .eq("status", "proposed")
      .limit(20),
    admin.from("growthmind_trend_items")
      .select("id, title, scores, updated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "recommended")
      .lte("updated_at", ago7d)
      .limit(20),
  ]);

  for (const c of connsRes.data ?? []) {
    const expiresAt = c.token_expires_at ? new Date(c.token_expires_at).getTime() : null;
    const expired = c.status === "expired" || c.status === "needs_reconnect" || (expiresAt !== null && expiresAt < now);
    const expiring = !expired && expiresAt !== null && c.token_expires_at <= in7d;
    if (!expired && !expiring) continue;
    findings.push({
      trigger_type: expired ? "growthmind_connection_expired" : "growthmind_connection_expiring",
      severity:     expired ? "critical" : "warning",
      priority:     expired ? "high" : "medium",
      title:        expired
        ? `Social connection "${c.account_name ?? c.username ?? c.provider}" needs reconnecting`
        : `Social connection "${c.account_name ?? c.username ?? c.provider}" expires soon`,
      description:  expired
        ? "Publishing and performance tracking are blocked until this account is reconnected in GrowthMind → Social Connections."
        : `The access token expires ${new Date(expiresAt!).toLocaleDateString("en-GB")}. Reconnect in GrowthMind → Social Connections to avoid publish failures.`,
      entity_type:  "growthmind_social_connections",
      entity_id:    String(c.id),
      entity_name:  c.account_name ?? c.username ?? c.provider,
    });
  }

  for (const j of failedJobsRes.data ?? []) {
    findings.push({
      trigger_type: "growthmind_publish_failed",
      severity:     "warning",
      priority:     "high",
      title:        `A ${j.platform} publish failed`,
      description:  `Publishing job failed${j.error_message ? `: ${String(j.error_message).slice(0, 300)}` : ""}. Open the project in Content Studio to fix and retry.`,
      entity_type:  "growthmind_publishing_jobs",
      entity_id:    String(j.id),
      entity_name:  null,
      metadata:     { project_id: j.project_id },
    });
  }

  for (const p of stuckProjectsRes.data ?? []) {
    findings.push({
      trigger_type: "growthmind_approval_stuck",
      severity:     "warning",
      priority:     "medium",
      title:        `Content "${p.title}" has been awaiting approval for 2+ days`,
      description:  "Approve or request changes in the HiveMind action centre so the content can go out while it is still timely.",
      entity_type:  "growthmind_content_projects",
      entity_id:    String(p.id),
      entity_name:  p.title,
    });
  }

  if ((patternsRes.data ?? []).length > 0) {
    const n = patternsRes.data.length;
    findings.push({
      trigger_type: "growthmind_learnings_pending",
      severity:     "info",
      priority:     "low",
      title:        `${n} performance learning${n === 1 ? "" : "s"} awaiting your review`,
      description:  "GrowthMind found patterns in your published-content results. Accept or reject them in GrowthMind → Performance Lab — accepted learnings steer future content scoring.",
      entity_type:  "growthmind_learned_patterns",
      entity_id:    `pending:${workspaceId}`,
      entity_name:  null,
      metadata:     { pending: n },
    });
  }

  for (const t of staleTrendsRes.data ?? []) {
    const total = Number((t.scores as any)?.total ?? 0);
    if (total < 70) continue;
    findings.push({
      trigger_type: "growthmind_trend_going_stale",
      severity:     "info",
      priority:     "medium",
      title:        `High-scoring trend "${String(t.title ?? "Untitled").slice(0, 120)}" is going stale`,
      description:  `This recommendation scored ${total}/100 over a week ago and hasn't been actioned. Trends decay fast — send it to Content Studio or dismiss it.`,
      entity_type:  "growthmind_trend_items",
      entity_id:    String(t.id),
      entity_name:  t.title ?? null,
    });
  }

  if (findings.length === 0) return { findings: 0, newTasks: 0, newEvents: 0 };

  // Dedup + insert (mirrors the HiveMind scanner pattern)
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const [existingRes, recentEvRes] = await Promise.all([
    admin.from("hivemind_tasks")
      .select("trigger_type,entity_id")
      .eq("workspace_id", workspaceId)
      .neq("status", "completed"),
    admin.from("hivemind_events")
      .select("event_type,entity_id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", oneDayAgo),
  ]);
  const existing = existingRes.data ?? [];
  const recent   = recentEvRes.data ?? [];

  let newTasks = 0, newEvents = 0;
  const eventRows: any[] = [];

  for (const f of findings) {
    const hasTask = existing.some((t: any) => t.trigger_type === f.trigger_type && t.entity_id === f.entity_id);
    if (!hasTask) {
      // Row-by-row: the open-task partial unique index makes 23505 = deduped.
      const { error } = await admin.from("hivemind_tasks").insert({
        workspace_id: workspaceId,
        title:        f.title,
        description:  f.description,
        status:       "suggested",
        priority:     f.priority,
        source:       "ai_scan",
        trigger_type: f.trigger_type,
        entity_type:  f.entity_type,
        entity_id:    f.entity_id,
        entity_name:  f.entity_name,
        metadata:     f.metadata ?? null,
      });
      if (!error) newTasks++;
      else if (error.code !== "23505") console.warn("[attention-scan] task insert failed:", error.message);
    }
    const hasEvent = recent.some((e: any) => e.event_type === f.trigger_type && e.entity_id === f.entity_id);
    if (!hasEvent) {
      eventRows.push({
        workspace_id: workspaceId,
        event_type:   f.trigger_type,
        severity:     f.severity,
        title:        f.title,
        description:  f.description,
        entity_type:  f.entity_type,
        entity_id:    f.entity_id,
        entity_name:  f.entity_name,
      });
    }
  }
  if (eventRows.length > 0) {
    const { error } = await admin.from("hivemind_events").insert(eventRows);
    if (!error) newEvents = eventRows.length;
  }

  // Executive event backbone (never-throw, deduped by entity)
  try {
    const { publishExecutiveEvent } = await import("@/lib/hivemind/executive-events.shared");
    for (const f of findings.filter((x) => x.severity !== "info").slice(0, 10)) {
      await publishExecutiveEvent(admin, {
        workspaceId,
        eventType:    "growthmind_attention_item",
        sourceSystem: "growthmind",
        severity:     f.severity,
        title:        f.title,
        summary:      f.description,
        entityType:   f.entity_type,
        entityId:     f.entity_id,
      } as any);
    }
  } catch { /* best-effort */ }

  return { findings: findings.length, newTasks, newEvents };
}
