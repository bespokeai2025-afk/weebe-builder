#!/usr/bin/env node
/**
 * scripts/audit-mind-creators.mjs
 *
 * Machine-generated audit of every function that inserts into:
 *   - hivemind_tasks
 *   - hivemind_actions
 *   - work_orders
 *
 * Outputs:
 *   - JSON report to stdout (or --json-out <path>)
 *   - Markdown registry to docs/CREATOR_REGISTRY.md (or --md-out <path>)
 *
 * Usage:
 *   node scripts/audit-mind-creators.mjs
 *   node scripts/audit-mind-creators.mjs --json-out /tmp/report.json --md-out docs/CREATOR_REGISTRY.md
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { resolve, relative } from "path";

const ROOT = resolve(process.cwd());
const args = process.argv.slice(2);
const getArg = (flag) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : null; };
const JSON_OUT = getArg("--json-out");
const MD_OUT   = getArg("--md-out") ?? "docs/CREATOR_REGISTRY.md";

// ── patterns to search ───────────────────────────────────────────────────────
const PATTERNS = [
  { pattern: '\\.from\\("hivemind_tasks"\\)\\.insert', table: "hivemind_tasks" },
  { pattern: "\\.from\\('hivemind_tasks'\\)\\.insert", table: "hivemind_tasks" },
  { pattern: '\\.from\\("hivemind_actions"\\)\\.insert', table: "hivemind_actions" },
  { pattern: "\\.from\\('hivemind_actions'\\)\\.insert", table: "hivemind_actions" },
  { pattern: '\\.from\\("work_orders"\\)\\.insert', table: "work_orders" },
  { pattern: "\\.from\\('work_orders'\\)\\.insert", table: "work_orders" },
];

const COMPLIANT_MARKERS = [
  "prepareMindTaskInsert",
  "insertWorkOrderWithStageTasks",
];

const JUSTIFIED_EXCEPTION_MARKERS = [
  "JUSTIFIED-EXCEPTION",
  "ALIAS-FREE",
  "justified-exception",
  "justified exception",
];

const DISABLED_MARKERS = [
  "LEGACY_CREATOR_BLOCKED",
];

function grep(pattern) {
  try {
    const result = spawnSync(
      "grep",
      ["-rn", "--include=*.ts", "--include=*.tsx", "-E", pattern, "src/"],
      { cwd: ROOT, encoding: "utf8" },
    );
    if (result.status !== 0 && !result.stdout) return [];
    return (result.stdout ?? "").trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function readFileSection(file, lineNum, context = 60) {
  try {
    const content = readFileSync(resolve(ROOT, file), "utf8");
    const lines = content.split("\n");
    const start = Math.max(0, lineNum - context);
    const end   = Math.min(lines.length, lineNum + context);
    return lines.slice(start, end).join("\n");
  } catch {
    return "";
  }
}

function detectStatus(file, lineNum) {
  const section = readFileSection(file, lineNum, 80);

  // Disabled first
  if (DISABLED_MARKERS.some((m) => section.includes(m))) return "disabled";

  // JUSTIFIED-EXCEPTION before COMPLIANT — comments on exception sites often
  // mention prepareMindTaskInsert in their explanation text, which would cause
  // false "compliant" positives if we checked COMPLIANT first.
  if (JUSTIFIED_EXCEPTION_MARKERS.some((m) => section.includes(m))) return "justified-exception";

  // Compliant if prepareMindTaskInsert or insertWorkOrderWithStageTasks is nearby
  if (COMPLIANT_MARKERS.some((m) => section.includes(m))) return "compliant";

  // Otherwise needs review
  return "needs-review";
}

function functionName(file, lineNum) {
  try {
    const content = readFileSync(resolve(ROOT, file), "utf8");
    const lines = content.split("\n");
    // Walk backwards from lineNum to find the nearest function/export
    for (let i = lineNum - 1; i >= Math.max(0, lineNum - 40); i--) {
      const l = lines[i];
      const m = l.match(/(?:export\s+(?:async\s+)?function|async\s+function|function|export\s+const)\s+(\w+)/);
      if (m) return m[1];
    }
    return "(anonymous)";
  } catch {
    return "(unknown)";
  }
}

function featureFromPath(file) {
  const segments = file.split("/");
  if (file.includes("growthmind-control")) return "GrowthMind/Monitoring";
  if (file.includes("content-attention-scan")) return "GrowthMind/ContentScan";
  if (file.includes("gsc-sync")) return "GrowthMind/GSC";
  if (file.includes("growthmind/growthmind.strategy")) return "GrowthMind/Strategy";
  if (file.includes("growthmind/growthmind.blog")) return "GrowthMind/BlogWriter";
  if (file.includes("growthmind/blog-draft-tick")) return "GrowthMind/BlogDraftTick";
  if (file.includes("growthmind/growthmind.video")) return "GrowthMind/VideoProposals";
  if (file.includes("growthmind/growthmind.campaign")) return "GrowthMind/CampaignProposals";
  if (file.includes("growthmind/growthmind.script")) return "GrowthMind/ScriptPerformance";
  if (file.includes("growthmind/growthmind")) return "GrowthMind";
  if (file.includes("accountsmind")) return "AccountsMind/Executor";
  if (file.includes("systemmind-automation")) return "SystemMind/Automation";
  if (file.includes("workspace-setup")) return "SystemMind/WorkspaceSetup";
  if (file.includes("systemmind-generators")) return "SystemMind/Generators";
  if (file.includes("legacy-conversion")) return "SystemMind/LegacyConverter";
  if (file.includes("channel-work-orders")) return "HiveMind/ChannelWorkOrders";
  if (file.includes("cross-channel-work-orders")) return "HiveMind/CrossChannelWorkOrders";
  if (file.includes("work-orders")) return "HiveMind/WorkOrders";
  if (file.includes("executive-reasoning")) return "HiveMind/ExecutiveReasoning";
  if (file.includes("hivemind.actions")) return "HiveMind/ActionExecutor";
  if (file.includes("hivemind.tasks")) return "HiveMind/Scanner";
  if (file.includes("mind-adapters/growthmind-gads")) return "HiveMind/MindAdapter/GadsAnalysis";
  if (file.includes("mind-adapters/universal")) return "HiveMind/MindAdapter/Universal";
  if (file.includes("campaign-reports")) return "Campaigns/ReportWriter";
  if (file.includes("workflow-executor")) return "WorkflowEngine/Executor";
  if (segments.length >= 2) return segments.slice(-2).join("/").replace(".server.ts", "").replace(".ts", "");
  return file.split("/").pop().replace(".ts", "");
}

function mindFromPath(file) {
  if (file.includes("growthmind") || file.includes("gsc-sync") || file.includes("blog-draft-tick")) return "growthmind";
  if (file.includes("accountsmind")) return "accountsmind";
  if (file.includes("systemmind") || file.includes("workspace-setup")) return "systemmind";
  if (file.includes("campaign-reports") || file.includes("workflow-engine")) return "cross-mind";
  return "hivemind";
}

// ── run audit ────────────────────────────────────────────────────────────────
const entries = [];
const seen = new Set();

for (const { pattern, table } of PATTERNS) {
  const hits = grep(pattern);
  for (const hit of hits) {
    const colonIdx = hit.indexOf(":");
    const file     = hit.slice(0, colonIdx).trim();
    const rest     = hit.slice(colonIdx + 1);
    const lineNum  = parseInt(rest.split(":")[0], 10);
    const key      = `${file}:${lineNum}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const rel    = relative(ROOT, resolve(ROOT, file));
    const status = detectStatus(rel, lineNum);
    const fn     = functionName(rel, lineNum);

    entries.push({
      function: fn,
      file: rel,
      line: lineNum,
      table,
      feature:    featureFromPath(rel),
      mind:       mindFromPath(rel),
      work_order_required: table === "work_orders" || table === "hivemind_tasks",
      packet_required:     table === "hivemind_tasks",
      adapter_registered:  table === "hivemind_actions" && rel.includes("mind-adapters"),
      status,
    });
  }
}

// Sort by table then file
entries.sort((a, b) => a.table.localeCompare(b.table) || a.file.localeCompare(b.file));

// ── output ───────────────────────────────────────────────────────────────────
const report = { generated_at: new Date().toISOString(), entries };

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
  console.error(`JSON report written to ${JSON_OUT}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}

// ── Markdown registry ────────────────────────────────────────────────────────
const statusBadge = (s) => ({
  "compliant":           "✅ compliant",
  "migrated":            "✅ migrated",
  "disabled":            "🚫 disabled",
  "justified-exception": "📝 justified-exception",
  "needs-review":        "⚠️ needs-review",
})[s] ?? s;

const cols = ["Function", "File", "Line", "Table", "Feature", "Mind", "Packet Required", "Adapter Registered", "Status"];
const rows = entries.map((e) => [
  `\`${e.function}\``,
  `\`${e.file}\``,
  String(e.line),
  `\`${e.table}\``,
  e.feature,
  e.mind,
  e.packet_required ? "Yes" : "No",
  e.adapter_registered ? "Yes" : "No",
  statusBadge(e.status),
]);

const header = `| ${cols.join(" | ")} |`;
const sep    = `| ${cols.map(() => "---").join(" | ")} |`;
const body   = rows.map((r) => `| ${r.join(" | ")} |`).join("\n");

const md = [
  "# Creator Registry",
  "",
  "> Machine-generated by `scripts/audit-mind-creators.mjs`. Run `node scripts/audit-mind-creators.mjs` to refresh.",
  "> Last generated: " + new Date().toISOString(),
  "",
  "## Summary",
  "",
  `Total creators: **${entries.length}**`,
  `- ✅ compliant/migrated: **${entries.filter((e) => e.status === "compliant" || e.status === "migrated").length}**`,
  `- 📝 justified-exception: **${entries.filter((e) => e.status === "justified-exception").length}**`,
  `- 🚫 disabled: **${entries.filter((e) => e.status === "disabled").length}**`,
  `- ⚠️ needs-review: **${entries.filter((e) => e.status === "needs-review").length}**`,
  "",
  "## Registry",
  "",
  header,
  sep,
  body,
  "",
  "## Status Definitions",
  "",
  "| Status | Meaning |",
  "| --- | --- |",
  "| ✅ compliant | Creator already passes through `prepareMindTaskInsert` or `insertWorkOrderWithStageTasks`. |",
  "| ✅ migrated | Creator was updated in Task #500 to use the standard path. |",
  "| 📝 justified-exception | Creator bypasses the gate for a documented valid reason (scanner/observation path, alias-free module, human-task, seeding). |",
  "| 🚫 disabled | Creator is blocked by a `LEGACY_CREATOR_BLOCKED` guard and will throw if called. |",
  "| ⚠️ needs-review | Creator status could not be determined automatically — review manually. |",
  "",
  "## Justified Exception Notes",
  "",
  "- **`hivemind.tasks.ts::runHiveMindScan`** — Platform scanner observation tasks. Uses `prepareMindTaskInsert` + `buildIntelligencePacket` (COMPLIANT).",
  "- **`gsc-sync-core.ts`** — Alias-free module loaded at Vite config time; cannot use `@/` dynamic imports. Creates a one-time informational task on first GSC data arrival. No AI Mind output.",
  "- **`systemmind-generators.server.ts`** — WhatsApp setup checklist tasks; setup-scaffold items (not AI proposals); gated by `isProposalAllowed`.",
  "- **`legacy-conversion.server.ts`** — Human-facing review task for unconverted items; human-task class, not AI Mind output.",
  "- **`workflow-executor.server.ts` (`create_task`, `notify_user`)** — User-configured workflow step nodes; created from a user-authored workflow definition, not from autonomous AI output.",
  "- **`growthmind_actions` creators** — These write to `hivemind_actions` (approval queue), not `hivemind_tasks`. The execution path in `hivemind.actions.ts::executeAction` enforces `prepareMindTaskInsert` at execution time.",
  "- **`mind-adapters/`** — Adapters run inside the execution context (`work_order_id`/`task_id` already bound); linked actions are in scope of an approved work order.",
  "",
].join("\n");

writeFileSync(resolve(ROOT, MD_OUT), md);
console.error(`Markdown registry written to ${MD_OUT}`);
console.error(`Audit complete: ${entries.length} creators found.`);
