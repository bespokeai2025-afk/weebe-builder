/**
 * Launches Buzzchat campaigns whose scheduled_at is due.
 * Dev: campaign-scheduler Vite plugin. Prod: /api/public/campaign-executor.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { launchWatiCampaignFromWebee } from "@/lib/dashboard/whatsapp.functions";

export async function runWhatsappScheduledCampaignTick(): Promise<{
  launched: number;
  failed: Array<{ id: string; error: string }>;
}> {
  const now = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("whatsapp_campaigns")
    .select("*")
    .eq("status", "scheduled")
    .not("scheduled_at", "is", null)
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(8);

  if (error) {
    console.warn("[whatsapp-schedule] query failed:", error.message);
    return { launched: 0, failed: [{ id: "-", error: error.message }] };
  }

  const failed: Array<{ id: string; error: string }> = [];
  let launched = 0;

  for (const campaign of due ?? []) {
    const workspaceId = String(campaign.workspace_id ?? "");
    const id = String(campaign.id ?? "");
    if (!workspaceId || !id) continue;
    try {
      await launchWatiCampaignFromWebee(supabaseAdmin, workspaceId, campaign as Record<string, unknown>, {
        allowOverlap: false,
      });
      launched++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failed.push({ id, error: message });
      await supabaseAdmin
        .from("whatsapp_campaigns")
        .update({
          status: "failed",
          stats: { error: message.slice(0, 400) },
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "scheduled");
    }
  }

  return { launched, failed };
}
