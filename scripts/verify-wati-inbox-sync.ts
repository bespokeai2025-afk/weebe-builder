/**
 * Verifies that the WATI inbox pipeline actually ingests inbound replies.
 *
 * Runs the real maybeSyncWatiInboxFromApi path (same code the BuzzChat inbox calls) and reports
 * counts only — never message bodies or phone numbers.
 *
 * Run: bun scripts/verify-wati-inbox-sync.ts
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { maybeSyncWatiInboxFromApi } from "@/lib/whatsapp/wati-inbox-sync.server";

const sb = supabaseAdmin as any;

async function counts(workspaceId: string) {
  const tally = async (build: (q: any) => any) => {
    const { count } = await build(
      sb.from("whatsapp_messages").select("id", { count: "exact", head: true }),
    );
    return count ?? 0;
  };

  return {
    inbound: await tally((q: any) => q.eq("workspace_id", workspaceId).eq("direction", "inbound")),
    inboundWithCampaign: await tally((q: any) =>
      q
        .eq("workspace_id", workspaceId)
        .eq("direction", "inbound")
        .not("campaign_id", "is", null),
    ),
    withConversationId: await tally((q: any) =>
      q.eq("workspace_id", workspaceId).not("conversation_id", "is", null),
    ),
    total: await tally((q: any) => q.eq("workspace_id", workspaceId)),
  };
}

const { data: connections } = await sb
  .from("wati_connections")
  .select("workspace_id, status, last_webhook_event_at")
  .eq("status", "connected");

if (!connections?.length) {
  console.log("No connected WATI workspaces.");
  process.exit(0);
}

for (const conn of connections as Array<{
  workspace_id: string;
  last_webhook_event_at: string | null;
}>) {
  const workspaceId = conn.workspace_id;
  console.log(`\n=== workspace ${workspaceId.slice(0, 8)}…`);
  console.log(`last webhook event: ${conn.last_webhook_event_at ?? "never"}`);

  const before = await counts(workspaceId);
  console.log("before:", before);

  const started = Date.now();
  const inserted = await maybeSyncWatiInboxFromApi(workspaceId, { force: true });
  console.log(`sync inserted ${inserted} message(s) in ${Date.now() - started}ms`);

  const after = await counts(workspaceId);
  console.log("after: ", after);

  const { count: conversationCount } = await sb
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  const { count: unreadThreads } = await sb
    .from("whatsapp_conversations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gt("unread_count", 0);

  console.log(`conversations: ${conversationCount ?? 0} (${unreadThreads ?? 0} with unread)`);
}

process.exit(0);
