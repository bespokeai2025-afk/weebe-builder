import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Resolve candidate Retell API keys for signature verification on incoming
 * custom-function webhook calls.
 *
 * Strategy:
 * 1. If a real agent_id is supplied, look up that agent's workspace and return
 *    its retell_workspace_id as the sole candidate (fast path).
 * 2. If the agent_id is missing, is Retell's synthetic "test_agent" value
 *    (sent by the "Test Custom Function" button in the Retell dashboard), or
 *    no matching agent is found in our DB, fall back to every workspace
 *    retell_workspace_id we have.  One of them will match the key that Retell
 *    used to sign the request, so verification will succeed.
 *
 * The platform RETELL_API_KEY / RETELL_WEBHOOK_SECRET is always tried first
 * by verifyRetellSignatureMultiKey — these candidates are the per-workspace
 * extras appended after that.
 */
export async function resolveRetellCandidateKeysByAgent(
  agentId: string | undefined,
): Promise<string[]> {
  if (agentId && agentId !== "test_agent") {
    const { data: agentLookup } = await supabaseAdmin
      .from("agents")
      .select("workspace_id")
      .or(
        `retell_agent_id.eq.${agentId},settings->>deployedRetellAgentId.eq.${agentId}`,
      )
      .maybeSingle();

    if (agentLookup?.workspace_id) {
      const { data: wsLookup } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", agentLookup.workspace_id)
        .maybeSingle();
      const wk = wsLookup?.retell_workspace_id?.trim();
      if (wk?.startsWith("key_")) return [wk];
    }
  }

  return resolveAllWorkspaceRetellKeys();
}

/**
 * Resolve candidate Retell API keys by booking UID (used by cancel /
 * reschedule endpoints which don't have an agent_id).
 *
 * Falls back to ALL workspace keys when the booking is not found — handles
 * Retell dashboard test calls that supply a dummy booking_id.
 */
export async function resolveRetellCandidateKeysByBooking(
  bookingId: string | undefined,
): Promise<string[]> {
  if (bookingId) {
    const { data: bkLookup } = await supabaseAdmin
      .from("bookings")
      .select("workspace_id")
      .eq("calcom_booking_uid", bookingId)
      .maybeSingle();

    if (bkLookup?.workspace_id) {
      const { data: wsLookup } = await supabaseAdmin
        .from("workspace_settings")
        .select("retell_workspace_id")
        .eq("workspace_id", bkLookup.workspace_id)
        .maybeSingle();
      const wk = wsLookup?.retell_workspace_id?.trim();
      if (wk?.startsWith("key_")) return [wk];
    }
  }

  return resolveAllWorkspaceRetellKeys();
}

/** Load every retell_workspace_id from workspace_settings as a fallback. */
async function resolveAllWorkspaceRetellKeys(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("workspace_settings")
    .select("retell_workspace_id");
  return (data ?? [])
    .map((r) => r.retell_workspace_id?.trim() ?? "")
    .filter((k) => k.startsWith("key_"));
}
