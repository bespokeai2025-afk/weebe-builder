/**
 * One-off cleanup for outbound messages stored twice: once optimistically at send time under a
 * synthesised id, once again when WATI reported the same message under its real `wamid`.
 *
 * Reports by default; pass `--apply` to delete. Ongoing prevention lives in
 * `whatsapp-message-dedupe.server.ts`, which both the send and sync paths now call.
 *
 * Usage:
 *   bunx tsx scripts/dedupe-whatsapp-optimistic-messages.ts <workspaceId> [--apply]
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import {
  findRedundantOptimisticMessageIds,
  type DedupeCandidateRow,
} from "../src/lib/whatsapp/whatsapp-message-dedupe.server";

function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq);
      let value = trimmed.slice(eq + 1).trim();
      if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // Env may already be provided by the shell.
  }
}

async function main() {
  loadEnv();

  const workspaceId = process.argv[2];
  const apply = process.argv.includes("--apply");
  if (!workspaceId) throw new Error("Usage: <workspaceId> [--apply]");

  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const byPhone = new Map<string, DedupeCandidateRow[]>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await sb
      .from("whatsapp_messages")
      .select("id, contact_phone, external_id, whatsapp_message_id, sent_at, body, direction")
      .eq("workspace_id", workspaceId)
      .eq("direction", "outbound")
      .order("sent_at", { ascending: false })
      .range(from, from + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = data ?? [];
    for (const row of rows) {
      const phone = String((row as { contact_phone?: string }).contact_phone ?? "");
      if (!byPhone.has(phone)) byPhone.set(phone, []);
      byPhone.get(phone)!.push(row as DedupeCandidateRow);
    }
    if (rows.length < pageSize) break;
  }

  const redundant: string[] = [];
  let affectedThreads = 0;

  for (const rows of byPhone.values()) {
    const ids = findRedundantOptimisticMessageIds(rows);
    if (ids.length === 0) continue;
    affectedThreads++;
    redundant.push(...ids);
  }

  console.log(`outbound messages scanned : ${[...byPhone.values()].reduce((n, r) => n + r.length, 0)}`);
  console.log(`threads with duplicates   : ${affectedThreads}`);
  console.log(`duplicate rows            : ${redundant.length}`);

  if (redundant.length === 0) return;
  if (!apply) {
    console.log("\nDry run — re-run with --apply to delete.");
    return;
  }

  let deleted = 0;
  for (let i = 0; i < redundant.length; i += 200) {
    const batch = redundant.slice(i, i + 200);
    const { error } = await sb.from("whatsapp_messages").delete().in("id", batch);
    if (error) throw new Error(error.message);
    deleted += batch.length;
  }

  console.log(`\ndeleted ${deleted} duplicate rows`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
