#!/usr/bin/env node
/**
 * generate-acceptance-report.mjs
 *
 * Runs the universal acceptance test matrix and writes the result to
 * docs/ACCEPTANCE_TEST_MATRIX.md, updating the per-family result table with
 * live pass/fail status.
 *
 * Usage:
 *   node scripts/generate-acceptance-report.mjs [--ci]
 *
 * Flags:
 *   --ci   Exit with code 1 if any test failed (suitable for CI pipelines).
 *
 * Output:
 *   - Prints a human-readable summary to stdout.
 *   - Overwrites docs/ACCEPTANCE_TEST_MATRIX.md with fresh results.
 *   - Exits 0 on all-pass, 1 on failures (only when --ci flag is set).
 */

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const CI_MODE = process.argv.includes("--ci");

// ── 1. Run vitest on the acceptance matrix file only ─────────────────────────

console.log("▶  Running universal acceptance test matrix…\n");

let rawOutput = "";
// exitCode: 0 = all pass, non-zero = vitest reported failures.
// We ALWAYS respect the actual process exit code for CI — parsing is only
// for human-readable reporting metadata and can miss edge cases.
let exitCode = 0;

try {
  rawOutput = execSync(
    "npx vitest run --config vitest.component.config.ts tests/component/acceptance-matrix.test.tsx --reporter=verbose 2>&1",
    { cwd: ROOT, encoding: "utf8" },
  );
  // execSync throws on non-zero exit; reaching here means exit code 0
  exitCode = 0;
} catch (err) {
  rawOutput = (err.stdout ?? "") + (err.stderr ?? "");
  // Preserve the real exit code from vitest — never assume 0 if it threw
  exitCode = (typeof err.status === "number" && err.status !== 0) ? err.status : 1;
}

// ── 2. Parse results ──────────────────────────────────────────────────────────

const lines = rawOutput.split("\n");

// Extract summary line (e.g. "Tests  59 passed (59)")
const summaryLine = lines.find((l) => /Tests\s+\d+ passed/.test(l)) ?? "";
const totalMatch  = summaryLine.match(/(\d+) passed/);
const failedMatch = summaryLine.match(/(\d+) failed/);
const totalPassed = totalMatch  ? Number(totalMatch[1])  : 0;
const totalFailed = failedMatch ? Number(failedMatch[1]) : 0;
const totalTests  = totalPassed + totalFailed;

// Extract per-test results: "✓ Family N..." or "× Family N..."
const testResults = [];
for (const line of lines) {
  const passMatch = line.match(/✓\s+(.+?)\s+\d+ms/);
  const failMatch = line.match(/×\s+(.+?)\s+\d+ms/);
  if (passMatch) testResults.push({ name: passMatch[1].trim(), passed: true });
  if (failMatch) testResults.push({ name: failMatch[1].trim(), passed: false });
}

// Classify by suite
const families = [
  { n: 1,  label: "Sales pipeline review (HiveMind)" },
  { n: 2,  label: "Follow-up sequence (HiveMind)" },
  { n: 3,  label: "WhatsApp campaign (HiveMind)" },
  { n: 4,  label: "Email campaign (HiveMind)" },
  { n: 5,  label: "Calls campaign (HiveMind)" },
  { n: 6,  label: "Cross-channel objective (HiveMind)" },
  { n: 7,  label: "Google Ads analysis (GrowthMind)" },
  { n: 8,  label: "Meta lead campaign (GrowthMind)" },
  { n: 9,  label: "TikTok content (GrowthMind)" },
  { n: 10, label: "LinkedIn content (GrowthMind)" },
  { n: 11, label: "SEO / GSC opportunity (GrowthMind)" },
  { n: 12, label: "Content deployment (GrowthMind)" },
  { n: 13, label: "Agent↔CRM integration (SystemMind)" },
  { n: 14, label: "Workflow depth review (SystemMind)" },
  { n: 15, label: "Invoice audit (AccountsMind)" },
  { n: 16, label: "Renewals audit (AccountsMind)" },
  { n: 17, label: "Outgoings audit (AccountsMind)" },
  { n: 18, label: "Client costing audit (AccountsMind)" },
];

function familyStatus(n) {
  const chainTest = testResults.find(
    (t) => t.name.includes(`Family ${n}:`) && t.name.includes("chain"),
  );
  if (!chainTest) return "UNKNOWN";
  return chainTest.passed ? "PASS" : "FAIL";
}

// ── 3. Print summary ──────────────────────────────────────────────────────────

const statusIcon = totalFailed === 0 ? "✅" : "❌";
console.log(`${statusIcon}  ${totalPassed} / ${totalTests} tests passed${totalFailed > 0 ? ` (${totalFailed} failed)` : ""}\n`);

console.log("Family results:");
for (const f of families) {
  const status = familyStatus(f.n);
  const icon   = status === "PASS" ? "✅" : status === "FAIL" ? "❌" : "⚠️ ";
  console.log(`  ${String(f.n).padStart(2, " ")}. ${icon}  ${f.label}`);
}

// Per-suite extras
const extraSuites = [
  { key: "Content safety regression", title: "Content safety regression" },
  { key: "Workspace isolation",        title: "Workspace isolation" },
  { key: "WBAH exclusion",             title: "WBAH exclusion" },
  { key: "Legacy pathway",             title: "Legacy pathway blocked" },
  { key: "Rollback",                   title: "Rollback (Contract F)" },
];

console.log("\nAdditional suites:");
for (const suite of extraSuites) {
  const relevant = testResults.filter((t) => t.name.includes(suite.key));
  if (relevant.length === 0) continue;
  const allPass = relevant.every((t) => t.passed);
  const icon    = allPass ? "✅" : "❌";
  console.log(`  ${icon}  ${suite.title} (${relevant.length} tests, ${relevant.filter((t) => t.passed).length} passed)`);
}

// ── 4. Update docs/ACCEPTANCE_TEST_MATRIX.md ─────────────────────────────────

const docPath = resolve(ROOT, "docs/ACCEPTANCE_TEST_MATRIX.md");
let doc = "";
try {
  doc = readFileSync(docPath, "utf8");
} catch {
  doc = "";
}

// Rewrite the run-metadata block at the top
const nowIso  = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
const runLine = `**Last run:** ${nowIso} — **${totalPassed}/${totalTests} passed**${totalFailed > 0 ? ` *(${totalFailed} FAILED)*` : ""}  `;

// Insert or replace a "Last run:" line after the title block
if (doc.includes("**Last run:**")) {
  doc = doc.replace(/\*\*Last run:\*\*.+/, runLine);
} else {
  // Inject after the first blank line following the header block
  doc = doc.replace(
    /(\*Generated by:\*.*\n)/,
    `$1${runLine}\n`,
  );
}

// Update family table rows: replace PASS/FAIL/UNKNOWN badges
for (const f of families) {
  const status = familyStatus(f.n);
  if (status === "UNKNOWN") continue;
  const badge  = status === "PASS" ? "**PASS**" : "**FAIL**";
  // Match the row for family N — line contains `| N |` pattern
  const rowRe  = new RegExp(`(\\| ${f.n} \\|[^|]+\\|[^|]+\\|)\\s*\\*\\*(?:PASS|FAIL|UNKNOWN)\\*\\*`, "g");
  doc = doc.replace(rowRe, `$1 ${badge}`);
}

writeFileSync(docPath, doc, "utf8");
console.log(`\n📄  Updated docs/ACCEPTANCE_TEST_MATRIX.md`);

// ── 5. Exit ───────────────────────────────────────────────────────────────────
// Use the real vitest exit code as the authoritative failure signal in CI.
// Parsed failure counts are used only for reporting — they can miss failures
// when output format changes.  exitCode is always set correctly from the
// execSync catch block above.

if (CI_MODE) {
  if (exitCode !== 0) {
    const detail = totalFailed > 0 ? `${totalFailed} test(s) failed` : "vitest exited non-zero";
    console.error(`\n❌  ${detail} — exiting with code ${exitCode} (--ci mode).`);
    process.exit(exitCode);
  }
} else if (exitCode !== 0 || totalFailed > 0) {
  const detail = totalFailed > 0 ? `${totalFailed} test(s) failed` : "vitest exited non-zero";
  console.warn(`\n⚠️   ${detail}. Re-run with --ci to exit non-zero.`);
}
