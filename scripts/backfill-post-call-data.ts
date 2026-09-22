/**
 * Re-runs post-call data retrieval for recent calls on one agent and stores the result.
 *
 * Calls made before custom fields were saved on the call (or before per-field extraction) have
 * none recorded. This reuses the exact production path — readAnalysisSchema + analyzeCall — so a
 * backfilled call looks the same as a new one.
 *
 * Only writes `custom_analysis_data`; never touches the transcript, summary or anything else.
 *
 * Usage: npx tsx scripts/backfill-post-call-data.ts <agentId> [--limit 5] [--apply]
 */
import fs from "node:fs";

for (const line of fs.readFileSync(".env", "utf8").split("\n")) {
  if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
  const i = line.indexOf("=");
  const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
}

const { readAnalysisSchema } = await import("../src/lib/voice/gateway/telephony-core.ts");
const { analyzeCall } = await import("../src/lib/voice/lifecycle/analysis.ts");

const argv = process.argv.slice(2);
const agentId = argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
const APPLY = argv.includes("--apply");
const limitIdx = argv.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : 5;
if (!agentId) throw new Error("Pass an agent id.");

const U = process.env.SUPABASE_URL!;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const get = async (p: string) => (await (await fetch(`${U}/rest/v1/${p}`, { headers: H })).json()) as any[];

const [agent] = await get(`agents?select=name,settings,variables&id=eq.${agentId}`);
if (!agent) throw new Error("Agent not found");
const schema = readAnalysisSchema(agent.settings ?? {}, agent.variables);
console.log(`${agent.name}: ${schema.length} post-call fields`);

const calls = await get(
  `calls?select=id,retell_call_id,transcript,duration_seconds,created_at&agent_id=eq.${agentId}&transcript=not.is.null&order=created_at.desc&limit=${LIMIT}`,
);

for (const call of calls) {
  const turns = String(call.transcript ?? "")
    .split("\n")
    .map((l: string) => {
      const m = /^(Agent|User)\s*:\s*(.*)$/i.exec(l.trim());
      return m ? { role: m[1].toLowerCase() === "agent" ? "agent" : "user", text: m[2] } : null;
    })
    .filter(Boolean) as Array<{ role: "agent" | "user"; text: string }>;
  if (!turns.some((t) => t.role === "user")) {
    console.log(`  ${call.created_at.slice(0, 16)}  skipped — caller never spoke`);
    continue;
  }
  const out = await analyzeCall({ turns, agentName: agent.name, schema, durationSeconds: call.duration_seconds ?? 0 });
  const data = out.custom_analysis_data ?? {};
  const filled = Object.values(data).filter((v) => v != null).length;
  console.log(`  ${call.created_at.slice(0, 16)}  ${call.retell_call_id}  ${filled}/${schema.length} fields`);
  if (APPLY) {
    const r = await fetch(`${U}/rest/v1/calls?id=eq.${call.id}`, {
      method: "PATCH",
      headers: { ...H, Prefer: "return=minimal" },
      body: JSON.stringify({ custom_analysis_data: data }),
    });
    if (!r.ok) console.warn(`    ! write failed ${r.status}`);
  }
}
console.log(APPLY ? "\nStored." : "\nDry run — add --apply to store.");
process.exit(0);
