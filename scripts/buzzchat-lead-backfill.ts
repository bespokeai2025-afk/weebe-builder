/**
 * BuzzChat → CRM Lead Pipeline — historical backfill
 *
 * Scans all inbound whatsapp_messages (provider=wati|meta|twilio, direction=inbound)
 * and ensures every one is linked to a canonical lead row with
 * has_buzzchat_reply=true and last_buzzchat_reply_at set correctly.
 *
 * Usage:
 *   npx tsx scripts/buzzchat-lead-backfill.ts --dry-run   # preview only
 *   npx tsx scripts/buzzchat-lead-backfill.ts --apply     # write to DB
 *
 * Processes in batches of 200 to avoid PostgREST 1000-row cap.
 * All operations are idempotent — safe to re-run.
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const BATCH_SIZE   = 200;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

const isDryRun = !process.argv.includes("--apply");
if (isDryRun && !process.argv.includes("--dry-run")) {
  console.error("Usage: npx tsx scripts/buzzchat-lead-backfill.ts [--dry-run|--apply]");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
}) as any;

interface MsgRow {
  id: string;
  workspace_id: string;
  contact_phone: string;
  contact_name: string | null;
  conversation_id: string | null;
  external_id: string | null;
  body: string | null;
  sent_at: string | null;
  created_at: string;
  lead_id: string | null;
}

interface Stats {
  messages: number;
  linked:   number; // message already had lead_id
  matched:  number; // found lead by phone
  created:  number; // created new lead
  skipped:  number; // no phone, couldn't process
  errors:   number;
}

async function main() {
  console.log(`\nBuzzChat → CRM Lead Backfill [${isDryRun ? "DRY RUN" : "APPLY"}]\n`);

  const stats: Stats = { messages: 0, linked: 0, matched: 0, created: 0, skipped: 0, errors: 0 };
  let offset = 0;

  while (true) {
    const { data: msgs, error } = await sb
      .from("whatsapp_messages")
      .select("id, workspace_id, contact_phone, contact_name, conversation_id, external_id, body, sent_at, created_at, lead_id")
      .eq("direction", "inbound")
      .in("provider", ["wati", "meta", "twilio"])
      .order("sent_at", { ascending: true })
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error("Query error:", error.message);
      break;
    }
    if (!msgs || msgs.length === 0) break;
    offset += msgs.length;
    stats.messages += msgs.length;

    for (const msg of msgs as MsgRow[]) {
      try {
        if (msg.lead_id) {
          // Message is already linked — just ensure buzzchat fields are stamped.
          stats.linked++;
          if (!isDryRun) {
            await stampBuzzChatFields(msg.workspace_id, msg.lead_id, msg.conversation_id, msg.sent_at ?? msg.created_at);
          }
          continue;
        }

        if (!msg.contact_phone) {
          stats.skipped++;
          continue;
        }

        // Match by conversation_id first, then phone.
        let leadId = await findLeadByConvOrPhone(msg.workspace_id, msg.contact_phone, msg.conversation_id);

        if (leadId) {
          stats.matched++;
          if (!isDryRun) {
            await sb.from("whatsapp_messages").update({ lead_id: leadId }).eq("id", msg.id);
            await stampBuzzChatFields(msg.workspace_id, leadId, msg.conversation_id, msg.sent_at ?? msg.created_at);
          } else {
            console.log(`  [match] ws=${msg.workspace_id} phone=${msg.contact_phone} → lead=${leadId}`);
          }
        } else {
          // Create new lead.
          stats.created++;
          if (!isDryRun) {
            const { data: newLead, error: createErr } = await sb
              .from("leads")
              .insert({
                workspace_id: msg.workspace_id,
                phone: msg.contact_phone,
                full_name: msg.contact_name ?? null,
                source: "whatsapp",
                status: "need_to_call",
                has_buzzchat_reply: true,
                last_buzzchat_reply_at: msg.sent_at ?? msg.created_at,
                buzzchat_conversation_id: msg.conversation_id ?? null,
                created_at: msg.created_at,
                updated_at: new Date().toISOString(),
              })
              .select("id")
              .single();
            if (createErr) { console.error("Create lead error:", createErr.message); stats.errors++; continue; }
            leadId = newLead.id;
            await sb.from("whatsapp_messages").update({ lead_id: leadId }).eq("id", msg.id);
          } else {
            console.log(`  [create] ws=${msg.workspace_id} phone=${msg.contact_phone} name=${msg.contact_name ?? "?"}`);
          }
        }
      } catch (e: any) {
        console.error("Error processing message", msg.id, e?.message ?? e);
        stats.errors++;
      }
    }

    process.stdout.write(`  Processed ${offset} messages...\r`);
    if (msgs.length < BATCH_SIZE) break;
  }

  console.log("\n\n── Backfill summary ───────────────────────────────────────");
  console.log(`  Total messages scanned : ${stats.messages}`);
  console.log(`  Already linked         : ${stats.linked}`);
  console.log(`  Matched to existing    : ${stats.matched}`);
  console.log(`  New leads created      : ${stats.created}`);
  console.log(`  Skipped (no phone)     : ${stats.skipped}`);
  console.log(`  Errors                 : ${stats.errors}`);
  if (isDryRun) {
    console.log("\n⚠️  Dry run — no data was written. Re-run with --apply to commit changes.");
  } else {
    console.log("\n✅  Backfill complete.");
  }
}

async function findLeadByConvOrPhone(
  workspaceId: string,
  phone: string,
  conversationId: string | null,
): Promise<string | null> {
  if (conversationId) {
    const { data } = await sb
      .from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("buzzchat_conversation_id", conversationId)
      .limit(1)
      .maybeSingle();
    if (data?.id) return data.id;
  }

  // Exact E.164 match.
  const { data: exact } = await sb
    .from("leads")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (exact?.id) return exact.id;

  // Tail match (last 10 digits).
  const digits = phone.replace(/\D/g, "");
  const tail = digits.length >= 10 ? digits.slice(-10) : null;
  if (tail) {
    const { data: rows } = await sb
      .from("leads")
      .select("id, phone")
      .eq("workspace_id", workspaceId)
      .ilike("phone", `%${tail}`)
      .limit(5);
    if (rows?.length) return rows[0].id;
  }

  return null;
}

async function stampBuzzChatFields(
  workspaceId: string,
  leadId: string,
  conversationId: string | null,
  replyAt: string,
): Promise<void> {
  const patch: Record<string, unknown> = {
    has_buzzchat_reply: true,
    updated_at: new Date().toISOString(),
  };
  // Only advance last_buzzchat_reply_at if the new value is later.
  const { data: current } = await sb
    .from("leads")
    .select("last_buzzchat_reply_at")
    .eq("id", leadId)
    .maybeSingle();
  const prev = current?.last_buzzchat_reply_at;
  if (!prev || new Date(replyAt) >= new Date(prev)) {
    patch.last_buzzchat_reply_at = replyAt;
  }
  if (conversationId && !current?.buzzchat_conversation_id) {
    patch.buzzchat_conversation_id = conversationId;
  }
  await sb.from("leads").update(patch).eq("id", leadId).eq("workspace_id", workspaceId);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
