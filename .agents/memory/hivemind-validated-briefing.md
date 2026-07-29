---
name: HiveMind validated briefing pipeline
description: Rules for the validated daily-briefing engine — one validated object drives voice + screen, honesty over fabrication.
---

Rule: all HiveMind briefing surfaces (chat morning briefing, TTS voice, stored briefings, briefings UI) must derive from ONE `ValidatedBusinessBriefing` (shared module `validated-briefing.shared.ts`, built server-side in `validated-briefing.server.ts`). Never let the LLM invent/recompute rates — verified metrics carry numerator/denominator/formula/source/timeRange and are injected verbatim into prompts with STRICT RULES.

**Why:** briefings previously fabricated percentages, reported missing financials as £0, and voice drifted from screen. Spec requires traceable KPIs and honest data-quality warnings.

**How to apply:**
- Missing financials → `UnverifiedMetric` with reason ("could not be confirmed"), never 0.
- Validation failure must be an explicit degraded state (`meta.validated_status = "failed"` + user-visible banner/prefix), never a silent fallback.
- Stored briefings keep the audit in `hivemind_briefings.meta.validated`; recommendation → task creation goes through `createBriefingTaskFn`, which re-reads the rec from the workspace-scoped briefing row (client sends ids only) and uses the intelligence-packet gate.
- Voice output: buildVoiceSummary caps ~160 words, strips markdown, truncates lists, keeps assessment + closing question.
