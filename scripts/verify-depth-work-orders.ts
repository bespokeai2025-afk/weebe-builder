/**
 * Task #494 — Verify depth work orders against real workspace data.
 *
 * Uses the ACTUAL server functions (not re-implementations) to exercise the
 * real code paths, packet builders, and guardrails.
 *
 * Usage:
 *   VERIFY_WORKSPACE_ID=<uuid> npx tsx scripts/verify-depth-work-orders.ts           # dry-run
 *   VERIFY_WORKSPACE_ID=<uuid> npx tsx scripts/verify-depth-work-orders.ts --confirm  # actually insert
 *
 * Env:
 *   VERIFY_WORKSPACE_ID        — required; explicit workspace to test (never auto-picked)
 *   SUPABASE_URL / VITE_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Exit codes:
 *   0 — all assertions passed (or dry-run completed successfully)
 *   1 — one or more assertions failed (details printed above the summary)
 */
import { createClient } from "@supabase/supabase-js";
import { classifyLegacyTasks } from "@/lib/minds/legacy-task-migration.server";
import { createFinancialAuditWorkOrderCore } from "@/lib/accountsmind/financial-audit-work-orders.server";
import { createCrossChannelObjectiveWorkOrderCore } from "@/lib/hivemind/cross-channel-work-orders.server";
import { WBAH_WORKSPACE_ID } from "@/lib/wbah-exclusion.shared";

// ── Config & guards ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_ID = process.env.VERIFY_WORKSPACE_ID;
const CONFIRM = process.argv.includes("--confirm");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!WORKSPACE_ID) {
  console.error(
    "Missing VERIFY_WORKSPACE_ID env var.\n" +
    "Set it to the UUID of a non-WBAH test workspace.\n" +
    "Example: VERIFY_WORKSPACE_ID=c13db1d5-22e4-44ad-b678-6f296c31a947 npx tsx scripts/verify-depth-work-orders.ts --confirm"
  );
  process.exit(1);
}
if (WORKSPACE_ID === WBAH_WORKSPACE_ID) {
  console.error(`VERIFY_WORKSPACE_ID is the WBAH workspace (${WBAH_WORKSPACE_ID}). Aborting.`);
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ── Failure tracking ──────────────────────────────────────────────────────────
// Every failed assertion appends here; process.exit(1) fires at the end.
const failures: string[] = [];

function section(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("═".repeat(70));
}
function ok(msg: string) { console.log(`  ✓ ${msg}`); }
function warn(msg: string) { console.log(`  ⚠ ${msg}`); }
function info(msg: string) { console.log(`    ${msg}`); }
/** Record a failed assertion: printed immediately AND collected for exit summary. */
function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
  failures.push(msg);
}
/** Fatal: print, collect, and exit immediately (unrecoverable error). */
function fatal(msg: string): never {
  fail(msg);
  printFailureSummary();
  process.exit(1);
}

function printFailureSummary() {
  if (failures.length === 0) return;
  console.log(`\n${"─".repeat(70)}`);
  console.log(`  FAILED ASSERTIONS (${failures.length}):`);
  for (const f of failures) console.log(`    ✗ ${f}`);
  console.log("─".repeat(70));
}

// ── Section 0: Workspace access ───────────────────────────────────────────────
section("0 · Workspace access check");
const { data: wsRow, error: wsErr } = await sb
  .from("workspaces")
  .select("id, name")
  .eq("id", WORKSPACE_ID)
  .maybeSingle();
if (wsErr || !wsRow) {
  fatal(`Cannot read workspace ${WORKSPACE_ID}: ${wsErr?.message ?? "not found"}`);
}
info(`Workspace: "${wsRow.name}" (${WORKSPACE_ID})`);
info(`Mode:      ${CONFIRM ? "WRITE (--confirm)" : "DRY-RUN (pass --confirm to insert work orders)"}`);
ok("Workspace accessible.");

// ── Section 1: classify_legacy_tasks — real function, read-only ───────────────
section("1 · classify_legacy_tasks — real server function (read-only)");

let classifications: Awaited<ReturnType<typeof classifyLegacyTasks>>;
try {
  classifications = await classifyLegacyTasks(sb, WORKSPACE_ID, { limit: 200 });
} catch (e: any) {
  fatal(`classifyLegacyTasks threw: ${e.message}`);
}

const { counts } = classifications;
info(`Classification breakdown:`);
for (const [klass, n] of Object.entries(counts)) {
  if (n > 0) info(`  ${klass.padEnd(18)} ${n}`);
}
info(`Total rows classified: ${classifications.classifications.length}`);

// Misfire check: convertible rows with very short titles are suspicious
const suspiciousConvertible = classifications.classifications.filter(
  (c) => c.klass === "convertible" && c.title.length < 10,
);
if (suspiciousConvertible.length > 0) {
  warn(`${suspiciousConvertible.length} "convertible" row(s) have very short titles (potential misfire):`);
  suspiciousConvertible.slice(0, 3).forEach((c) =>
    info(`  [${c.taskId}] "${c.title}" — ${c.reason}`)
  );
} else {
  ok("No suspicious convertible rows with very short titles.");
}

// Sample a few of each interesting class
for (const klass of ["convertible", "missing_context", "duplicate", "superseded"] as const) {
  const sample = classifications.classifications.filter((c) => c.klass === klass).slice(0, 2);
  for (const s of sample) {
    info(`  [${klass}] "${s.title.slice(0, 60)}" — ${s.reason.slice(0, 80)}`);
  }
}
ok("classify_legacy_tasks (real function) — complete.");

// ── Section 2: outgoings_audit work order ────────────────────────────────────
section("2 · Financial audit work order — outgoings_audit");

if (!CONFIRM) {
  warn("Dry-run: skipping work order insert. Pass --confirm to create and then clean up.");
  info("Would call: createFinancialAuditWorkOrderCore(sb, workspaceId, null, 'outgoings_audit')");
} else {
  let auditResult: Awaited<ReturnType<typeof createFinancialAuditWorkOrderCore>>;
  try {
    auditResult = await createFinancialAuditWorkOrderCore(
      sb,
      WORKSPACE_ID,
      null, // no user — verification context
      "outgoings_audit",
      { source: "verify_script:task_494" },
    );
  } catch (e: any) {
    fatal(`createFinancialAuditWorkOrderCore threw: ${e.message}`);
  }

  const { workOrder, tasks, audit } = auditResult;
  info(`Audit: ${audit.records_inspected} record(s), ${audit.exceptions.length} exception(s)`);
  ok(`Work order: id=${workOrder.id}  readiness=${workOrder.readiness_state}  status=${workOrder.status}`);

  if (tasks.length !== 3) {
    fail(`Expected 3 stage tasks, got ${tasks.length}`);
  } else {
    ok("3 stage tasks created.");
  }

  // Verify every stage's sensitive flag and readiness
  const stageMeta = tasks.map((t: any) => ({
    stage: t.metadata?.approval_stage as string | undefined,
    sensitive: t.intelligence_packet?.approval_scope?.sensitive as boolean | undefined,
    readiness: t.readiness_state as string | null,
    kind: t.intelligence_packet?.approval_scope?.kind as string | undefined,
  }));

  for (const s of stageMeta) {
    const isExecute = s.stage === "execute";
    const sensitiveOk = isExecute ? s.sensitive === true : s.sensitive === false;
    const readinessOk = isExecute ? s.readiness === "blocked" : s.readiness?.startsWith("ready");
    const marker = sensitiveOk && readinessOk ? "✓" : "✗";
    info(`  [${marker}] stage=${s.stage}  kind=${s.kind}  sensitive=${s.sensitive}  readiness=${s.readiness}`);
    if (!sensitiveOk) fail(`Stage "${s.stage}" has wrong sensitive value: ${s.sensitive} (execute must be true, others false)`);
    if (!readinessOk) fail(`Stage "${s.stage}" has wrong readiness: ${s.readiness} (execute must be blocked, others ready_*)`);
  }

  const executeStage = stageMeta.find((s) => s.stage === "execute");
  if (executeStage?.sensitive === true && executeStage?.readiness === "blocked") {
    ok("Execute stage: sensitive=true, blocked ✓ (billing gate enforced).");
  }

  // Clean up — mark work order cancelled, tasks completed
  const { error: woDel } = await sb.from("work_orders").update({ status: "cancelled" }).eq("id", workOrder.id);
  if (woDel) warn(`Cleanup work order: ${woDel.message}`);
  else ok(`Work order ${workOrder.id} cancelled (cleanup).`);

  const taskIds = tasks.map((t: any) => t.id);
  const { error: tDel } = await sb.from("hivemind_tasks").update({
    status: "completed",
    completion_evidence: "Verification task created by Task #494 QA script — cleaned up.",
  }).in("id", taskIds);
  if (tDel) warn(`Cleanup tasks: ${tDel.message}`);
  else ok(`${taskIds.length} stage task(s) completed (cleanup).`);
}

// ── Section 3: cross-channel work order ─────────────────────────────────────
section("3 · Cross-channel work order");

if (!CONFIRM) {
  warn("Dry-run: skipping cross-channel work order insert. Pass --confirm to create and clean up.");
  info("Would call: createCrossChannelObjectiveWorkOrderCore(sb, workspaceId, null, { objective: '...' })");
} else {
  let ccResult: Awaited<ReturnType<typeof createCrossChannelObjectiveWorkOrderCore>>;
  try {
    ccResult = await createCrossChannelObjectiveWorkOrderCore(
      sb,
      WORKSPACE_ID,
      null,
      {
        objective: "Increase qualified lead conversions via AI outreach — verification test run (Task #494)",
        source: "verify_script:task_494",
      },
    );
  } catch (e: any) {
    fatal(`createCrossChannelObjectiveWorkOrderCore threw: ${e.message}`);
  }

  const { workOrder, strategyTask, channelTasks, justified, skipped } = ccResult;

  info(`Justified channels (${justified.length}): ${justified.map((j) => j.channel).join(", ") || "none"}`);
  info(`Skipped channels  (${skipped.length}): ${skipped.map((s) => `${s.channel}(${s.reason.slice(0, 40)})`).join(", ") || "none"}`);
  ok(`Work order: id=${workOrder.id}  readiness=${workOrder.readiness_state}`);
  ok(`Strategy task: id=${strategyTask.id}  status=${strategyTask.status}`);

  // Child tasks must all be blocked and dependency-linked
  const allBlocked = channelTasks.every((t: any) => t.readiness_state === "blocked");
  const allLinked = channelTasks.every((t: any) => (t.dependencies ?? []).includes(String(strategyTask.id)));
  if (allBlocked) ok(`All ${channelTasks.length} channel task(s) readiness=blocked ✓`);
  else fail(`Some channel task(s) are not blocked: ${channelTasks.filter((t: any) => t.readiness_state !== "blocked").map((t: any) => `${t.id}=${t.readiness_state}`).join(", ")}`);
  if (allLinked) ok(`All channel task(s) carry strategy dependency ✓`);
  else fail("Some channel task(s) are missing the strategy task dependency.");

  // No channel child task should be marked sensitive (launches need their own chain)
  const anySensitive = channelTasks.some((t: any) => t.intelligence_packet?.approval_scope?.sensitive === true);
  if (!anySensitive) ok("No channel child task is sensitive (sends need their own approval chain) ✓");
  else fail("A channel child task is incorrectly marked sensitive.");

  // When no channels are justified, readiness must be blocked
  if (justified.length === 0) {
    if (workOrder.readiness_state === "blocked") {
      ok("Work order correctly set to blocked when no channel is justified ✓");
    } else {
      fail(`Work order readiness=${workOrder.readiness_state} (expected blocked when 0 justified channels)`);
    }
  } else {
    for (const j of justified) info(`  [JUSTIFIED] ${j.channel}: ${j.reason}`);
  }

  // Clean up
  const allTaskIds = [strategyTask.id, ...channelTasks.map((t: any) => t.id)];
  const { error: ccWoDel } = await sb.from("work_orders").update({ status: "cancelled" }).eq("id", workOrder.id);
  if (ccWoDel) warn(`Cleanup cross-channel WO: ${ccWoDel.message}`);
  else ok(`Cross-channel work order ${workOrder.id} cancelled (cleanup).`);

  const { error: ccTDel } = await sb.from("hivemind_tasks").update({
    status: "completed",
    completion_evidence: "Verification task created by Task #494 QA script — cleaned up.",
  }).in("id", allTaskIds);
  if (ccTDel) warn(`Cleanup cross-channel tasks: ${ccTDel.message}`);
  else ok(`${allTaskIds.length} cross-channel task(s) completed (cleanup).`);
}

// ── Final summary ──────────────────────────────────────────────────────────────
section("Summary");
info(`Workspace:           "${wsRow.name}" (${WORKSPACE_ID})`);
info(`Mode:                ${CONFIRM ? "WRITE — work orders created and cleaned up" : "DRY-RUN — no DB writes performed"}`);
info(`Legacy tasks:        ${classifications.classifications.length} rows: ${
  Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(", ")
}`);
info(`Classifier misfires: ${suspiciousConvertible.length} suspected`);
console.log();

if (failures.length > 0) {
  printFailureSummary();
  process.exit(1);
} else {
  ok(CONFIRM
    ? "All verification checks passed — real server functions exercised on live data."
    : "Dry-run complete — pass --confirm to exercise the write paths too."
  );
}
