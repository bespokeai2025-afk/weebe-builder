// SERVER ONLY server-fns — Trend Scout monitored source management.
// growthmind_monitored_sources is RLS SELECT-only for members; all writes go
// through the service-role admin client after an explicit membership check.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const SOURCE_KINDS = [
  "competitor_direct",
  "competitor_indirect",
  "industry_creator",
  "aspirational_brand",
  "customer_account",
  "target_topic",
  "keyword",
  "hashtag",
  "excluded_account",
  "excluded_topic",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_META: Record<SourceKind, { label: string; group: "accounts" | "topics" | "exclusions"; cap: number; hint: string }> = {
  competitor_direct:   { label: "Direct Competitors",    group: "accounts",   cap: 15, hint: "Businesses selling the same thing to the same buyers." },
  competitor_indirect: { label: "Indirect Competitors",  group: "accounts",   cap: 10, hint: "Alternative solutions your buyers consider." },
  industry_creator:    { label: "Industry Creators",     group: "accounts",   cap: 15, hint: "Creators and educators your audience follows." },
  aspirational_brand:  { label: "Aspirational Brands",   group: "accounts",   cap: 10, hint: "Brands whose content style you want to learn from." },
  customer_account:    { label: "Customer Accounts",     group: "accounts",   cap: 10, hint: "Customers or communities worth listening to." },
  target_topic:        { label: "Target Topics",         group: "topics",     cap: 20, hint: "Subjects GrowthMind should watch for trends." },
  keyword:             { label: "Keywords",              group: "topics",     cap: 25, hint: "Search terms and phrases to track." },
  hashtag:             { label: "Hashtags",              group: "topics",     cap: 20, hint: "Hashtags to monitor for momentum." },
  excluded_account:    { label: "Blocked Accounts",      group: "exclusions", cap: 50, hint: "Accounts GrowthMind must never surface." },
  excluded_topic:      { label: "Blocked Topics",        group: "exclusions", cap: 50, hint: "Topics GrowthMind must never recommend." },
};

const PLATFORMS = ["instagram", "facebook", "youtube", "tiktok", "web", "any"] as const;

export type MonitoredSource = {
  id: string;
  sourceKind: SourceKind;
  platform: string | null;
  value: string;
  label: string | null;
  priority: number;
  status: "active" | "paused";
  notes: string | null;
  createdAt: string;
};

function mapRow(r: any): MonitoredSource {
  return {
    id: r.id,
    sourceKind: r.source_kind,
    platform: r.platform,
    value: r.value,
    label: r.label,
    priority: r.priority ?? 0,
    status: r.status,
    notes: r.notes,
    createdAt: r.created_at,
  };
}

async function assertMember(sb: any, workspaceId: string, userId: string): Promise<void> {
  const { data: member, error } = await sb
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error("Membership check failed");
  if (!member) throw new Error("Not a member of this workspace");
}

// ── List ───────────────────────────────────────────────────────────────────────

export const listMonitoredSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("growthmind_monitored_sources")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(`Failed to load sources: ${error.message}`);
    return { sources: (data ?? []).map(mapRow) };
  });

// ── Add ────────────────────────────────────────────────────────────────────────

const AddInput = z.object({
  sourceKind: z.enum(SOURCE_KINDS),
  platform:   z.enum(PLATFORMS).nullish(),
  value:      z.string().trim().min(1).max(300),
  label:      z.string().trim().max(120).nullish(),
  priority:   z.number().int().min(0).max(10).optional(),
  notes:      z.string().trim().max(500).nullish(),
});

export const addMonitoredSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof AddInput>) => AddInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    const userId = context.userId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, userId);

    const { getTrendAdminClient } = await import("@/lib/growthmind/trend-discovery.server");
    const admin = getTrendAdminClient();

    // Per-kind workspace cap
    const cap = SOURCE_KIND_META[data.sourceKind].cap;
    const { count, error: cntErr } = await admin
      .from("growthmind_monitored_sources")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("source_kind", data.sourceKind);
    if (cntErr) throw new Error(`Cap check failed: ${cntErr.message}`);
    if ((count ?? 0) >= cap) {
      throw new Error(`Limit reached — up to ${cap} ${SOURCE_KIND_META[data.sourceKind].label.toLowerCase()} per workspace.`);
    }

    const { data: row, error } = await admin
      .from("growthmind_monitored_sources")
      .insert({
        workspace_id:     workspaceId,
        source_kind:      data.sourceKind,
        platform:         data.platform ?? null,
        value:            data.value,
        label:            data.label ?? null,
        priority:         data.priority ?? 0,
        notes:            data.notes ?? null,
        added_by_user_id: userId,
      })
      .select("*")
      .single();
    if (error) {
      if (error.code === "23505") throw new Error("This source is already on the list.");
      throw new Error(`Failed to add source: ${error.message}`);
    }
    return { source: mapRow(row) };
  });

// ── Update (pause/resume/priority/label/notes) ────────────────────────────────

const UpdateInput = z.object({
  id:       z.string().uuid(),
  status:   z.enum(["active", "paused"]).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  label:    z.string().trim().max(120).nullish(),
  notes:    z.string().trim().max(500).nullish(),
});

export const updateMonitoredSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof UpdateInput>) => UpdateInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { getTrendAdminClient } = await import("@/lib/growthmind/trend-discovery.server");
    const admin = getTrendAdminClient();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined)   patch.status = data.status;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.label !== undefined)    patch.label = data.label;
    if (data.notes !== undefined)    patch.notes = data.notes;

    const { data: row, error } = await admin
      .from("growthmind_monitored_sources")
      .update(patch)
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(`Failed to update source: ${error.message}`);
    if (!row) throw new Error("Source not found");
    return { source: mapRow(row) };
  });

// ── Remove ─────────────────────────────────────────────────────────────────────

const RemoveInput = z.object({ id: z.string().uuid() });

export const removeMonitoredSource = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: z.infer<typeof RemoveInput>) => RemoveInput.parse(i))
  .handler(async ({ data, context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await assertMember(context.supabase, workspaceId, context.userId);

    const { getTrendAdminClient } = await import("@/lib/growthmind/trend-discovery.server");
    const admin = getTrendAdminClient();
    const { error } = await admin
      .from("growthmind_monitored_sources")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(`Failed to remove source: ${error.message}`);
    return { ok: true };
  });
