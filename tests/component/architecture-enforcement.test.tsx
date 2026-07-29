/**
 * Architecture Enforcement Tests — Universal Standard (Task #502)
 *
 * These tests scan SOURCE CODE (not runtime behaviour) to enforce the WEBEE
 * Mind execution architecture. They run under 3 seconds, need no DB / API, and
 * use only Node.js `fs` + regex.
 *
 * Adding a new capability?  Follow the checklist in
 * src/lib/hivemind/execution-state.shared.ts before landing it.
 *
 * 10 rules enforced permanently:
 *  R1  — hivemind_tasks inserts go through prepareMindTaskInsert
 *  R2  — every EXECUTABLE_KINDS key has a dispatchAdapter case
 *  R3  — every dispatchAdapter case is in EXECUTABLE_KINDS (bidirectional)
 *  R4  — write / sensitive tool registrations declare featureFamily
 *  R5  — stagePacket approval scope never uses kind "review"
 *  R6  — raw work_orders inserts only in canonical helper files
 *  R7  — only the engine and acknowledgeMindTask complete hivemind_tasks
 *  R8  — content-generation adapters wire runContentSafetyCheck
 *  R9  — every EXECUTABLE_KINDS kind appears in ≥1 test file
 *  R10 — no src file imports from a *.client.* module path
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ── File system helpers ──────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, "../../");
const SRC  = path.join(ROOT, "src");
const TESTS = path.join(ROOT, "tests");

/** Recursively collect files whose name ends with one of `exts`. */
function walkFiles(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

/** Read a file relative to SRC root. */
function readSrc(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), "utf-8");
}

/** Relative path from repo root, forward-slash separated. */
function rel(abs: string): string {
  return abs.replace(ROOT + path.sep, "").replace(/\\/g, "/");
}

// ── Pre-load key source files ────────────────────────────────────────────────

const execStateSource  = readSrc("lib/hivemind/execution-state.shared.ts");
const dispatchSource   = readSrc("lib/hivemind/mind-execution-engine.server.ts");
const allSrcFiles      = walkFiles(SRC, [".ts", ".tsx"]);
const allTestFiles     = walkFiles(TESTS, [".ts", ".tsx"]);

// ── Extract EXECUTABLE_KINDS keys from source ────────────────────────────────

function parseExecutableKinds(src: string): string[] {
  // The EXECUTABLE_KINDS block is between the opening `{` after `= {` and the
  // closing `};`.  We extract quoted "namespace.action" keys from that block.
  const blockMatch = src.match(/export const EXECUTABLE_KINDS[^=]+=\s*\{([\s\S]*?)\n\};/);
  if (!blockMatch) throw new Error("Could not locate EXECUTABLE_KINDS block in source");
  const block = blockMatch[1];
  const kinds: string[] = [];
  const keyRe = /"([\w]+\.[\w]+)":/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) {
    kinds.push(m[1]);
  }
  return kinds;
}

// ── Extract dispatchAdapter case strings from source ─────────────────────────

function parseDispatchCases(src: string): string[] {
  const kinds: string[] = [];
  // if-branch for gads (outside the switch):
  const ifMatch = src.match(/if\s*\(\s*kind\s*===\s*"([\w.]+)"\s*\)/);
  if (ifMatch) kinds.push(ifMatch[1]);
  // switch/case strings:
  const caseRe = /case\s+"([\w]+\.[\w]+)":/g;
  let m: RegExpExecArray | null;
  while ((m = caseRe.exec(src)) !== null) {
    kinds.push(m[1]);
  }
  return kinds;
}

// ═══════════════════════════════════════════════════════════════════════════════
// R1 — hivemind_tasks inserts go through the quality gate
// ═══════════════════════════════════════════════════════════════════════════════

describe("R1 — hivemind_tasks insert gate", () => {
  /**
   * Every file that inserts into hivemind_tasks must either:
   *  a) call prepareMindTaskInsert (the universal quality gate), OR
   *  b) call insertWorkOrderWithStageTasks (which calls prepareMindTaskInsert
   *     internally for every stage task), OR
   *  c) be on the documented-exception allowlist below.
   *
   * Documented exceptions — each carries a comment in the source explaining why
   * a raw insert is acceptable (human-task / onboarding notice / alias-free):
   */
  const ALLOWED_RAW_INSERT_FILES = new Set([
    // Legacy-logic converter: inserts a plain "review notice" reminder with no
    // intelligence packet by design — it IS the review notice, not AI output.
    "src/lib/systemmind/legacy-conversion.server.ts",
    // Generator proposals: shallow informational tasks with no packet required
    // because the "evidence" is the provider state already shown in the UI.
    "src/lib/systemmind/systemmind-generators.server.ts",
    // GSC onboarding notice: one-time informational task seeded on first data
    // arrival; alias-free constraint prevents a dynamic import of the gate here.
    "src/lib/growthmind/gsc-sync-core.ts",
  ]);

  it("every hivemind_tasks insert file calls the quality gate or is an allowlisted exception", () => {
    const violations: string[] = [];

    for (const file of allSrcFiles) {
      const src = fs.readFileSync(file, "utf-8");
      if (!src.includes('.from("hivemind_tasks").insert')) continue;

      const relPath = rel(file);
      if (ALLOWED_RAW_INSERT_FILES.has(relPath)) continue;

      const hasGate =
        src.includes("prepareMindTaskInsert") ||
        src.includes("insertWorkOrderWithStageTasks");

      if (!hasGate) {
        violations.push(
          `${relPath} inserts into hivemind_tasks without calling ` +
          `prepareMindTaskInsert or insertWorkOrderWithStageTasks. ` +
          `Add the gate call or add this file to ALLOWED_RAW_INSERT_FILES with a documented reason.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R2 — every EXECUTABLE_KINDS key has a dispatchAdapter case
// ═══════════════════════════════════════════════════════════════════════════════

describe("R2 — EXECUTABLE_KINDS → dispatchAdapter coverage", () => {
  it("every kind registered in EXECUTABLE_KINDS has a handler in dispatchAdapter", () => {
    const kinds   = parseExecutableKinds(execStateSource);
    const cases   = parseDispatchCases(dispatchSource);
    const caseSet = new Set(cases);

    expect(kinds.length).toBeGreaterThanOrEqual(1);

    const missing = kinds.filter((k) => !caseSet.has(k));
    expect(missing).toEqual(
      [],
      `Kinds registered in EXECUTABLE_KINDS but missing a dispatchAdapter case: [${missing.join(", ")}]. ` +
      `Add a case to the switch in mind-execution-engine.server.ts.`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R3 — every dispatchAdapter case is in EXECUTABLE_KINDS (bidirectional)
// ═══════════════════════════════════════════════════════════════════════════════

describe("R3 — dispatchAdapter → EXECUTABLE_KINDS bidirectional check", () => {
  it("every dispatchAdapter case string is registered in EXECUTABLE_KINDS", () => {
    const kinds    = parseExecutableKinds(execStateSource);
    const kindSet  = new Set(kinds);
    const cases    = parseDispatchCases(dispatchSource);

    expect(cases.length).toBeGreaterThanOrEqual(1);

    const orphans = cases.filter((c) => !kindSet.has(c));
    expect(orphans).toEqual(
      [],
      `dispatchAdapter cases not registered in EXECUTABLE_KINDS: [${orphans.join(", ")}]. ` +
      `Either add the kind to EXECUTABLE_KINDS or remove the dead case.`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R4 — write / sensitive tool registrations declare featureFamily
// ═══════════════════════════════════════════════════════════════════════════════

describe("R4 — write/sensitive tool registrations must declare featureFamily", () => {
  /**
   * enrichCapability() enforces this at registration time, but this static
   * scan gives an early-warning in CI before a server restart is needed.
   *
   * Strategy: for each registerMindTool({ ... }) block in source files, check
   * that if the block contains `access: "write"` it also contains `featureFamily`.
   * We use a 120-line window from the opening `registerMindTool({` call.
   */
  it("every write/sensitive registerMindTool block declares featureFamily", () => {
    const violations: string[] = [];

    for (const file of allSrcFiles) {
      const src = fs.readFileSync(file, "utf-8");
      if (!src.includes("registerMindTool(")) continue;

      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].includes("registerMindTool({")) continue;

        // Collect the registration block (up to 120 lines or first `});`)
        const blockLines: string[] = [];
        let depth = 0;
        for (let j = i; j < Math.min(i + 120, lines.length); j++) {
          const line = lines[j];
          blockLines.push(line);
          depth += (line.match(/\{/g) ?? []).length;
          depth -= (line.match(/\}/g) ?? []).length;
          if (j > i && depth <= 0) break;
        }
        const block = blockLines.join("\n");

        const isWrite     = /access:\s*["']write["']/.test(block);
        const isSensitive = /sensitive:\s*true/.test(block);
        const hasFamily   = /featureFamily:/.test(block);

        if ((isWrite || isSensitive) && !hasFamily) {
          const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
          const toolName = nameMatch ? nameMatch[1] : `tool at line ${i + 1}`;
          violations.push(
            `${rel(file)} — "${toolName}": access=write or sensitive=true requires featureFamily. ` +
            `Add featureFamily to the registerMindTool call.`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R5 — stagePacket approval scope never uses kind "review"
// ═══════════════════════════════════════════════════════════════════════════════

describe('R5 — stagePacket approval scope never uses kind "review"', () => {
  /**
   * "review" is NOT an approvable approval_scope kind. The valid kinds are:
   * "analysis" | "change" | "content" | "execution" (see ApprovalScopeKind in
   * channel-packets.shared.ts). Using "review" would create tasks that can
   * never reach an approvable readiness state.
   */
  it('no stage definition passes kind: "review" to stagePacket', () => {
    const violations: string[] = [];

    const stageFiles = [
      "lib/hivemind/channel-work-orders.server.ts",
      "lib/hivemind/social-work-orders.server.ts",
      "lib/hivemind/cross-channel-work-orders.server.ts",
      "lib/accountsmind/financial-audit-work-orders.server.ts",
      "lib/systemmind/systemmind-depth-work-orders.server.ts",
    ];

    for (const rel of stageFiles) {
      const file = path.join(SRC, rel);
      if (!fs.existsSync(file)) continue;
      const src = fs.readFileSync(file, "utf-8");

      // Look for `kind: "review"` inside an actual stage object literal.
      // The negative lookahead (?!\s*\|) excludes TypeScript union type
      // definitions like `kind: "review" | "analysis" | ...` which are
      // harmless — they describe the allowed values of a type, not an
      // actual stage assignment.
      const reviewRe = /kind:\s*["']review["'](?!\s*\|)/g;
      let m: RegExpExecArray | null;
      while ((m = reviewRe.exec(src)) !== null) {
        const lineNum = src.slice(0, m.index).split("\n").length;
        violations.push(
          `${rel}:${lineNum} — kind: "review" is not an approvable ApprovalScopeKind. ` +
          `Use "analysis" | "change" | "content" | "execution" instead.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R6 — raw work_orders inserts only in canonical helper files
// ═══════════════════════════════════════════════════════════════════════════════

describe("R6 — work_orders inserts stay inside canonical helper files", () => {
  /**
   * Direct `.from("work_orders").insert(` calls must only exist in the three
   * canonical helper files. All other code should call insertWorkOrderWithStageTasks
   * (or the equivalent helper) to guarantee consistent packet + stage task creation.
   */
  const CANONICAL_WORK_ORDER_FILES = new Set([
    "src/lib/hivemind/channel-work-orders.server.ts",
    "src/lib/hivemind/cross-channel-work-orders.server.ts",
    "src/lib/hivemind/work-orders.server.ts",
  ]);

  it("raw work_orders inserts only appear in the canonical helper implementations", () => {
    const violations: string[] = [];

    for (const file of allSrcFiles) {
      const src = fs.readFileSync(file, "utf-8");
      if (!src.includes('.from("work_orders").insert')) continue;

      const relPath = rel(file);
      if (CANONICAL_WORK_ORDER_FILES.has(relPath)) continue;

      violations.push(
        `${relPath} does a raw .from("work_orders").insert(. ` +
        `Use insertWorkOrderWithStageTasks from channel-work-orders.server.ts instead, ` +
        `or add this file to CANONICAL_WORK_ORDER_FILES with a documented reason.`,
      );
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R7 — only the engine and acknowledgeMindTask complete hivemind_tasks
// ═══════════════════════════════════════════════════════════════════════════════

describe("R7 — only authorized paths transition hivemind_tasks to completed", () => {
  /**
   * Two authorized write paths for hivemind_tasks status transitions:
   *  1. mind-execution-engine.server.ts — setTaskExecutionState() drives the
   *     full execution lifecycle including status: "completed".
   *  2. hivemind.tasks.ts — acknowledgeMindTaskCore() marks informational
   *     Mind tasks done with evidence.
   *
   * Any other file that contains BOTH a hivemind_tasks reference AND a direct
   * status: "completed" write (not a filter/read) is a violation.
   */
  const AUTHORIZED_COMPLETION_FILES = new Set([
    "src/lib/hivemind/mind-execution-engine.server.ts",
    "src/lib/hivemind/hivemind.tasks.ts",
  ]);

  it("no unauthorized file writes status completed to hivemind_tasks", () => {
    const violations: string[] = [];

    for (const file of allSrcFiles) {
      const relPath = rel(file);
      if (AUTHORIZED_COMPLETION_FILES.has(relPath)) continue;

      const src = fs.readFileSync(file, "utf-8");
      if (!src.includes('"hivemind_tasks"')) continue;

      // Strategy: find every line that references hivemind_tasks in an .update(
      // chain, then check the next 10 lines for a literal `status: "completed"`.
      // This scopes the check to the specific Supabase call chain rather than
      // the whole file — preventing false positives from other tables (e.g.
      // systemmind_runs) that happen to write status: "completed" in the same
      // file.
      const lines = src.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Look for the start of a hivemind_tasks query chain
        if (!line.includes('"hivemind_tasks"')) continue;

        // Collect the next 10 lines as the chain window
        const chainEnd = Math.min(i + 10, lines.length);
        const window = lines.slice(i, chainEnd).join("\n");

        // The chain must have an .update( call (not just .select / .delete /
        // .insert / filter methods) AND directly assign status: "completed".
        // We exclude .eq("status", ...) / .neq(...) / .in(...) patterns which
        // are filter methods (reads), not writes.
        const hasUpdate = window.includes(".update(");
        const hasLiteralCompletion = /status\s*:\s*["']completed["']/.test(window);

        if (hasUpdate && hasLiteralCompletion) {
          violations.push(
            `${relPath}:${i + 1} — hivemind_tasks .update( chain appears to write ` +
            `status: "completed" directly. Route lifecycle transitions through ` +
            `setTaskExecutionState (engine) or acknowledgeMindTaskCore (informational tasks).`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R8 — content-generation adapter files wire runContentSafetyCheck
// ═══════════════════════════════════════════════════════════════════════════════

describe("R8 — content generation paths call runContentSafetyCheck", () => {
  /**
   * Any file that produces content drafts for external publication must gate
   * output through runContentSafetyCheck before storing / returning. The
   * canonical list covers all known content-generation adapter paths.
   *
   * To add a new content adapter: add it here AND wire the safety check.
   */
  const CONTENT_GENERATION_FILES: { file: string; label: string }[] = [
    { file: "lib/hivemind/channel-work-orders.server.ts",      label: "channel work orders" },
    { file: "lib/hivemind/social-work-orders.server.ts",       label: "social work orders" },
    { file: "lib/growthmind/growthmind.content.ts",            label: "GrowthMind content" },
    { file: "lib/growthmind/growthmind.video-studio.ts",       label: "GrowthMind video studio" },
    { file: "lib/growthmind/seo-blog-campaign.server.ts",      label: "SEO blog campaign" },
  ];

  it("all known content-generation files import or call runContentSafetyCheck", () => {
    const violations: string[] = [];

    for (const { file, label } of CONTENT_GENERATION_FILES) {
      const fullPath = path.join(SRC, file);
      if (!fs.existsSync(fullPath)) {
        violations.push(`${file} (${label}) — file not found. Update the list if it was renamed.`);
        continue;
      }
      const src = fs.readFileSync(fullPath, "utf-8");
      if (!src.includes("runContentSafetyCheck") && !src.includes("content-safety")) {
        violations.push(
          `${file} (${label}) — does not reference runContentSafetyCheck. ` +
          `Wire the content safety gate before content leaves this adapter.`,
        );
      }
    }

    expect(violations).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R9 — every EXECUTABLE_KINDS kind appears in ≥1 test file
// ═══════════════════════════════════════════════════════════════════════════════

describe("R9 — EXECUTABLE_KINDS test coverage", () => {
  /**
   * Whenever a new executable kind is added, at least one test file must
   * reference its kind string to prove coverage intent. The test can be in
   * tests/component/ or anywhere else under tests/.
   *
   * Kinds that are intentionally tested indirectly via higher-level integration
   * tests may be added to COVERAGE_EXEMPTIONS with a documented reason.
   */
  const COVERAGE_EXEMPTIONS = new Set<string>([
    // legacy migration is a one-time upgrade path tested via execution-state tests
    "hivemind.legacy_task_migration",
  ]);

  it("every EXECUTABLE_KINDS entry is referenced in ≥1 test file", () => {
    const kinds = parseExecutableKinds(execStateSource);
    const allTestSrc = allTestFiles
      .map((f) => fs.readFileSync(f, "utf-8"))
      .join("\n");

    const missing = kinds.filter(
      (k) => !COVERAGE_EXEMPTIONS.has(k) && !allTestSrc.includes(k),
    );

    expect(missing).toEqual(
      [],
      `EXECUTABLE_KINDS entries with no test-file reference: [${missing.join(", ")}]. ` +
      `Add at least one test that mentions the kind string, or add it to COVERAGE_EXEMPTIONS ` +
      `with a documented reason.`,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// R10 — no src file imports from a *.client.* module path
// ═══════════════════════════════════════════════════════════════════════════════

describe("R10 — import protection: no .client. imports in src", () => {
  /**
   * The Vite SSR import-protection plugin blocks any file whose name contains
   * `.client.` from being imported in server (SSR) contexts. Importing such a
   * file crashes SSR silently or with a cryptic error. The rule: no TypeScript
   * file under src/ may have a static import from a path that includes `.client.`
   *
   * See .agents/memory/import-protection-trap.md for the full context.
   */
  it("no src file imports from a *.client.* path", () => {
    const violations: string[] = [];
    // Matches: from "...something.client.something..." (static imports only)
    const clientImportRe = /from\s+["'][^"']*\.client\.[^"']*["']/g;

    for (const file of allSrcFiles) {
      const src = fs.readFileSync(file, "utf-8");
      const matches = [...src.matchAll(clientImportRe)];
      for (const m of matches) {
        const lineNum = src.slice(0, m.index).split("\n").length;
        violations.push(`${rel(file)}:${lineNum} — ${m[0].trim()}`);
      }
    }

    expect(violations).toEqual(
      [],
      `Files importing from *.client.* paths crash SSR. ` +
      `Rename the imported file to remove ".client." from its path, ` +
      `or convert the import to a dynamic import with proper guards.`,
    );
  });
});
