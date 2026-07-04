import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─────────────────────────────────────────────────────────────────────────────
// Unified, per-workspace, per-module sync-state tracking.
//
// This layer is STRICTLY ADDITIVE and DESCRIPTIVE:
//   • It only records the OUTCOME of syncs that already run on demand / manually.
//   • It NEVER triggers a sync and NEVER contacts an external API.
//   • recordSyncState never throws — a bookkeeping failure must not break the
//     sync that called it — and no-ops gracefully until the migration is applied.
// Backing table: supabase/migrations/SYNC_STATE_MIGRATION.sql
// ─────────────────────────────────────────────────────────────────────────────

export type SyncStatus = "idle" | "running" | "success" | "partial" | "error";

export interface SyncStateRow {
  id: string;
  workspace_id: string;
  source_name: string;
  module: string;
  last_successful_sync_at: string | null;
  last_attempted_sync_at: string | null;
  last_cursor: string | null;
  last_external_updated_at: string | null;
  sync_status: SyncStatus;
  error_message: string | null;
  records_created: number;
  records_updated: number;
  records_skipped: number;
  created_at: string;
  updated_at: string;
}

function isRelationMissing(err: any): boolean {
  const code = String(err?.code ?? "");
  const msg = String(err?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("does not exist") ||
    msg.includes("schema cache") ||
    msg.includes("could not find the table")
  );
}

async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [profileRes, roleRes] = await Promise.all([
    (supabaseAdmin as any).from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
    (supabaseAdmin as any).from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle(),
  ]);
  return profileRes.data?.user_type === "admin" || !!roleRes.data;
}

export interface RecordSyncInput {
  workspaceId: string;
  sourceName: string;
  module: string;
  status: SyncStatus;
  recordsCreated?: number;
  recordsUpdated?: number;
  recordsSkipped?: number;
  errorMessage?: string | null;
  lastCursor?: string | null;
  lastExternalUpdatedAt?: string | null;
}

// Upsert one (workspace, source, module) sync-state row. On a conflict update,
// only the supplied columns change, so an "error" record preserves the previous
// last_successful_sync_at (that column is only written on success/partial).
export async function recordSyncState(input: RecordSyncInput): Promise<void> {
  try {
    if (!input.workspaceId) return;
    const now = new Date().toISOString();
    const succeeded = input.status === "success" || input.status === "partial";

    const row: Record<string, unknown> = {
      workspace_id: input.workspaceId,
      source_name: input.sourceName,
      module: input.module,
      last_attempted_sync_at: now,
      sync_status: input.status,
      error_message: input.errorMessage ?? null,
      records_created: input.recordsCreated ?? 0,
      records_updated: input.recordsUpdated ?? 0,
      records_skipped: input.recordsSkipped ?? 0,
      updated_at: now,
    };
    if (succeeded) row.last_successful_sync_at = now;
    if (input.lastCursor !== undefined) row.last_cursor = input.lastCursor;
    if (input.lastExternalUpdatedAt !== undefined) row.last_external_updated_at = input.lastExternalUpdatedAt;

    const { error } = await (supabaseAdmin as any)
      .from("sync_state")
      .upsert(row, { onConflict: "workspace_id,source_name,module" });

    if (error && !isRelationMissing(error)) {
      console.error("[sync-state] record failed:", error.message ?? error);
    }
  } catch (e: any) {
    if (!isRelationMissing(e)) console.error("[sync-state] record threw:", e?.message ?? e);
  }
}

// Read the sync-state rows for a workspace. Platform admins may read any
// workspace; other users may only read a workspace they belong to. Returns
// applied:false (never throws) when the migration has not been applied yet.
export const getSyncState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ workspaceId: z.string().uuid().optional() }))
  .handler(async ({ data, context }) => {
    const targetWs = data?.workspaceId ?? context.workspaceId;
    if (!targetWs) throw new Error("No workspace specified");

    const isAdmin = await isPlatformAdmin(context.userId);
    if (!isAdmin) {
      const { data: mem } = await (supabaseAdmin as any)
        .from("workspace_members")
        .select("id")
        .eq("user_id", context.userId)
        .eq("workspace_id", targetWs)
        .maybeSingle();
      if (!mem) throw new Error("Access denied");
    }

    try {
      const { data: rows, error } = await (supabaseAdmin as any)
        .from("sync_state")
        .select("*")
        .eq("workspace_id", targetWs)
        .order("module", { ascending: true });

      if (error) {
        if (isRelationMissing(error)) return { applied: false, rows: [] as SyncStateRow[] };
        throw error;
      }
      return { applied: true, rows: (rows ?? []) as SyncStateRow[] };
    } catch (e: any) {
      if (isRelationMissing(e)) return { applied: false, rows: [] as SyncStateRow[] };
      throw e;
    }
  });
