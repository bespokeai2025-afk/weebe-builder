/**
 * New-lead notification helper — fires a "lead_created" workspace
 * notification (in-app + optional email, per workspace notification
 * settings) whenever a genuinely NEW lead row is inserted.
 *
 * Best-effort by design: NEVER throws, so no lead-creation path can fail
 * because of notifications. Bulk sync paths (WBAH) must NOT call this.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type NewLeadNotifyInput = {
  workspaceId: string;
  leadId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
};

export async function notifyNewLead(input: NewLeadNotifyInput): Promise<void> {
  try {
    if (!input.workspaceId || !input.leadId) return;
    const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");
    if (isWbahWorkspaceId(input.workspaceId)) return;
    const { emitCampaignNotification } = await import(
      "@/lib/notifications/notification-engine.shared"
    );
    const who = input.name?.trim() || input.email?.trim() || input.phone?.trim() || "Unknown contact";
    const details = [
      input.phone ? `Phone: ${input.phone}` : null,
      input.email ? `Email: ${input.email}` : null,
      input.source ? `Source: ${input.source}` : null,
    ].filter(Boolean).join(" · ");
    await emitCampaignNotification(supabaseAdmin as any, {
      workspaceId: input.workspaceId,
      eventKey: "lead_created",
      campaignName: who,
      summary: details || null,
      severity: "info",
    });
  } catch (err: any) {
    console.warn("[lead-notify] notifyNewLead failed (non-fatal):", err?.message ?? err);
  }
}
