/**
 * One-off catch-up: pull every WATI chat into BuzzChat, including chat status.
 *
 * The inbox sync deliberately polls a slice of chats per pass to stay fast, so a workspace whose
 * conversations predate the integration needs one full sweep. Reports counts only — never message
 * bodies or phone numbers.
 *
 * Run: bun scripts/backfill-wati-inbox.ts
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { backfillWatiInbox } from "@/lib/whatsapp/wati-inbox-sync.server";

const sb = supabaseAdmin as any;

async function snapshot(workspaceId: string) {
  const messages = async (build: (q: any) => any) => {
    const { count } = await build(
      sb.from("whatsapp_messages").select("id", { count: "exact", head: true }),
    );
    return count ?? 0;
  };
  const conversations = async (build: (q: any) => any) => {
    const { count } = await build(
      sb.from("whatsapp_conversations").select("id", { count: "exact", head: true }),
    );
    return count ?? 0;
  };

  return {
    inbound: await messages((q: any) =>
      q.eq("workspace_id", workspaceId).eq("direction", "inbound"),
    ),
    threadsWithReplies: await conversations((q: any) =>
      q.eq("workspace_id", workspaceId).not("last_inbound_at", "is", null),
    ),
    withWatiStatus: await conversations((q: any) =>
      q.eq("workspace_id", workspaceId).not("wati_chat_status", "is", null),
    ),
    expired: await conversations((q: any) =>
      q.eq("workspace_id", workspaceId).eq("wati_chat_status", "expired"),
    ),
    conversations: await conversations((q: any) => q.eq("workspace_id", workspaceId)),
  };
}

const { data: connections } = await sb
  .from("wati_connections")
  .select("workspace_id")
  .eq("status", "connected");

if (!connections?.length) {
  console.log("No connected WATI workspaces.");
  process.exit(0);
}

for (const { workspace_id: workspaceId } of connections as Array<{ workspace_id: string }>) {
  console.log(`\n=== workspace ${workspaceId.slice(0, 8)}…`);
  console.log("before:", await snapshot(workspaceId));

  const started = Date.now();
  const inserted = await backfillWatiInbox(workspaceId);
  console.log(`backfill inserted ${inserted} message(s) in ${Math.round((Date.now() - started) / 1000)}s`);

  console.log("after: ", await snapshot(workspaceId));
}

process.exit(0);
