/**
 * WBAH live-data helpers shared by the WBAH server modules: the workspace id, the incremental
 * WeeBespoke/Retell refresh run when a WBAH page opens, and the platform-admin / Retell key checks.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [profileRes, roleRes] = await Promise.all([
    (supabaseAdmin as any).from("profiles").select("user_type").eq("user_id", userId).maybeSingle(),
    (supabaseAdmin as any)
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle(),
  ]);
  return profileRes.data?.user_type === "admin" || !!roleRes.data;
}

export const WBAH_WORKSPACE_ID = "5cb750b6-fabf-4e84-9b92-740df1cd8d53";

let _liveRefreshInflight: Promise<void> | null = null;

export async function refreshWbahLiveData(
  workspaceId: string,
  opts?: { awaitResult?: boolean; lightBackfill?: boolean },
): Promise<void> {
  if (workspaceId !== WBAH_WORKSPACE_ID) return;

  const run = async () => {
    try {
      const { refreshWbahCallsFromRetell } = await import("./wbah-retell-calls-sync");
      await refreshWbahCallsFromRetell();
    } catch (e: any) {
      console.warn("[wbah-live] retell refresh failed:", e?.message ?? e);
    }
    try {
      const {
        refreshWbahAppointmentBackfill,
        syncWbahBookedContactsFromCrm,
        syncWbahBookedContactsFromCalls,
      } = await import("./wbah-leads-sync-tick");
      const [booked, fromCalls] = await Promise.all([
        syncWbahBookedContactsFromCrm(),
        syncWbahBookedContactsFromCalls(),
      ]);
      if (booked.rows > 0 || fromCalls.rows > 0) {
        const { invalidateWbahAggregate } = await import("./wbah-leads.server");
        await invalidateWbahAggregate(workspaceId);
      }
      await refreshWbahAppointmentBackfill(
        opts?.lightBackfill ? { maxPages: 3 } : { maxPages: 25 },
      );
    } catch (e: any) {
      console.warn("[wbah-live] appointment backfill failed:", e?.message ?? e);
    }
  };

  if (opts?.awaitResult) {
    return run();
  }

  if (!_liveRefreshInflight) {
    _liveRefreshInflight = run().finally(() => {
      _liveRefreshInflight = null;
    });
  }
  void _liveRefreshInflight;
}

export async function requireWbahRetellKey(userId: string): Promise<string> {
  if (!userId) throw new Error("Unauthorized");

  // Platform admins bypass workspace membership check
  const admin = await isPlatformAdmin(userId);
  if (!admin) {
    const { data: memberships } = await (supabaseAdmin as any)
      .from("workspace_members")
      .select("workspace_id, workspaces(slug)")
      .eq("user_id", userId);

    const wbahMembership = (memberships ?? []).find(
      (m: any) => m.workspaces?.slug === "webuyanyhouse",
    );
    if (!wbahMembership) {
      throw new Error("Access denied — not a member of the Webuyanyhouse workspace");
    }
  }

  const { data: ws } = await (supabaseAdmin as any)
    .from("workspace_settings")
    .select("retell_workspace_id")
    .eq("workspace_id", WBAH_WORKSPACE_ID)
    .maybeSingle();

  const apiKey = (ws?.retell_workspace_id as string | undefined)?.trim();
  if (!apiKey) {
    throw new Error(
      "Retell not connected for WeeBespoke workspace — add API key in Settings → Providers",
    );
  }
  return apiKey;
}
