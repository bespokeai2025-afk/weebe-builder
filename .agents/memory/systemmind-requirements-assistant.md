---
name: SystemMind Requirements assistant
description: Guided agent-workflow requirements interview in the Build Workspace — invariants and design rules.
---

# SystemMind Guided Requirements assistant

The Build Workspace's Requirements tab runs a gap-driven interview against a target agent and
produces build versions through the existing protected Apply / Go Live pipeline.

**Rules to stay consistent with:**
- Generation is **deterministic** (no AI spend, no usage events). AI is used ONLY on the
  re-prompt path, which translates plain language into an answers patch that is re-validated by
  the same whitelist as manual answering, then the deterministic generator re-runs. Usage events
  are recorded on both success and failure of the model call (and NOT before any spend).
- Script additions are approval-gated drafts. Approval merges into the prompt as a **new build
  version** (previous version = rollback point); the live agent row is never mutated by any
  interview/generate/approve step — only Apply touches workspace config, and even Apply never
  edits the live agent or flips auto-call switches. Scheduled calling creates the campaign PAUSED.
- Simulation is pure (no provider calls, no CRM writes). Canned scenarios must include
  callback_requested and webform_lead (webform is simulated from calling mode, not an outcome
  rule) — spec required these explicitly.
- WBAH is hard-blocked on EVERY entry point of the flow, including read (get) and simulate,
  via assertNotWbahForDeployment — reviewers flag missing asserts on "harmless" read paths.
- Answers are whitelist-validated: unknown keys and out-of-catalog choice values throw.
- The interview follows a fixed 9-step SOP order (purpose → data source/access key → fields to
  pull → agent functions/calling → post-call data & destination → page filters → Template Studio
  docs → per-sentiment follow-ups → sentiment→CRM outcomes). Sections render in insertion order,
  so keep new questions inside the right numbered section.
- Data-source access keys are stored by NAME only (never a value); the key name flows into the
  build config's required_credentials so the required-key box renders. Conditional questions
  (key name, page filters, template name) only appear after the parent answer is saved because
  answering re-runs the question builder.

**Why:** the whole feature's safety story is "drafts until explicit approval, one workspace only";
any shortcut (direct prompt merge, unpaused campaign, unvalidated AI patch) breaks it.
**How to apply:** any extension (new question kinds, new outcome rules, new simulation scenarios)
must keep generation deterministic and route changes through new build versions.
