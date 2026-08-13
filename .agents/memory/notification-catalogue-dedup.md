---
name: Notification catalogue, capabilities & dedup
description: Durable invariants for the workspace notification catalogue, capability filtering, and event-level dedup
---

- Event catalogue lockstep: every event key needs a label, a catalogue def (category/capability/deepLink) AND the DB check constraint on `workspace_notification_settings.event_key` updated in the same change; a component test enforces the engine side.
- **Why:** a key missing from the constraint makes settings writes fail; missing from defs breaks UI grouping and provisioning.
- Legacy keys keep historic default-ON behaviour; only newly-added keys may default off. Derive defaults per-event, never mutate the shared default object.
- Capability filtering is display/provisioning only and must fail OPEN. Trap: the entitlements resolver never throws — failures come back as an all-false feature set, indistinguishable from a broken lookup. Treat all-false as INDETERMINATE → all capabilities on, uncached. Config-probe errors also fail open per-capability.
- Event dedup: emitters pass a stable source-derived `dedupeKey` (`event:call:<providerCallId>`, `lead_created:lead:<id>`, msg id, etc.); winner = atomic ignoreDuplicates upsert returning a row; losers skip everything. Ledger errors fail OPEN — never drop notifications. Only dedupe when a stable source id exists; time-window keys risk suppressing legitimate repeats.
- Provisioning is insert-only (conflict-ignore) so it can never overwrite admin-customised rows; a rerunnable sweep script exists for backfilling new keys across existing workspaces.
