---
name: SystemMind Legacy Logic Converter
description: Architecture + schema traps for converting legacy sources (agents, workflows, n8n, hexmail, WATI, webforms, manual) into Build Workspace drafts.
---

# SystemMind Legacy Logic Converter

Converts legacy logic into Build Workspace DRAFT sessions with a structured conversion report.
Core: `src/lib/systemmind/legacy-conversion.server.ts` (+ `.functions.ts` server fns, UI in
`SystemMindBuildWorkspacePage` converter dialog / Conversion tab, `?convert=1` entry from
WorkflowEnginePage).

## Rules that must hold
- **Never-overwrite**: readers are SELECT-only; every conversion creates a fresh session (or
  edit-mode seeding for the `workflow` type). Going live routes only through the existing Apply
  pipeline.
- **Credential scrub before storage**: `validateConfigOrThrow` + `assertNoCredentialValues` on
  `{config, report}` run BEFORE session create / conversion-row insert. A credential-shaped value
  anywhere rejects the whole conversion.
- **WBAH hard-blocked both directions** (id constant + live slug lookup) before any read/write.
- n8n Code/Function nodes are never executed — flagged `unsupported_requires_review` and turned
  into a HiveMind manual-review task (so nothing is silently dropped).
- Lineage lives in `systemmind_conversions` (migration 20260718000000, applied to live DB);
  insert is best-effort — Conversion tab simply won't show if it fails.

## Schema traps found the hard way
- `hivemind_tasks.status` CHECK allows ONLY `suggested | approved | in_progress | completed`.
  `"open"` violates it. (`workflow-executor.server.ts` still inserts `"open"` with a swallowed
  `.catch` — pre-existing silent failure, unfixed.)
- `workspace_workflows` has a `status` column, NOT `is_active`. Selecting `is_active` errors —
  and any `safe()`/catch wrapper turns that into a silently empty list. Derive
  `is_active = status === "active"`.

## Test pattern
`tests/e2e/legacy-conversion.e2e.test.ts` mirrors build-workspace-protection: random-UUID
workspaces, borrowed owner_id, afterAll cleanup across all touched tables. WBAH-block test uses
the REAL WBAH workspace id (slug is unique in the shared DB, can't insert a fake) — safe because
the block throws before any write.
