---
name: Universal Mind Intelligence Packet & quality gate
description: How Mind-created tasks are validated (packet, readiness states, approvable gate) and the traps in extending it
---

# Universal Mind Intelligence Packet & Quality Gate

Contract: `src/lib/minds/intelligence-packet.shared.ts` (pure types/validator); gate:
`src/lib/minds/intelligence-packet.server.ts`. Columns `intelligence_packet` / `readiness_state`
/ `packet_version` exist on `hivemind_tasks` AND `work_orders` (migration
`20260726090000_universal_intelligence_packet.sql`, applied live).

Rules future work must keep:
- **Every server insert of a Mind task must go through `prepareMindTaskInsert`.** Shallow
  title+description output throws `MindTaskQualityGateError`. Human-created manual tasks pass with
  `{ humanTask: true }` → labelled `metadata.human_task` and stripped of executable fields.
- **Readiness pipeline order** (validator): context → blockers → target resolution → evidence →
  diagnosis → completeness → `ready_for_{scope}`. Only `ready_for_*_approval` /
  `ready_for_execution` are approvable; `ready_for_review` is NOT.
- **Honest cost rule:** `cost.known === false` with any `amount` ⇒ proposal_incomplete /
  sanitizer-rejected. Never invent amounts.
- **Enforcement point** is `assertTaskApprovable` inside `approveAndRunTask`. Legacy rows (NULL
  readiness AND NULL packet) are allowed by design; a packet without approvable readiness blocks.
- **Untrusted packets** (e.g. `action_payload.intelligence_packet` on hivemind_actions
  `create_task`) must pass `sanitizeIncomingPacket` — malformed shapes return null and the caller
  rebuilds a server-side packet. Never persist a raw payload packet.
- **Never hand-build packet literals** — always `buildIntelligencePacket` /
  `buildInvestigationPacket` so shapes can't drift from the contract.
- Unedited legacy insert paths are classified in `docs/UNIVERSAL_LEGACY_PATH_REGISTER.md`; they are
  informational-only (never set `task_category=executable`) so they can't reach the run gate.

**Why:** spec "Universal Intelligence, Execution and Campaign Operating Standard" — Minds must not
create shallow/fake-executable tasks; approval must be evidence-backed and honest about cost.
**How to apply:** any new Mind task creation path (new executive, new scanner, new chat tool)
routes through `prepareMindTaskInsert` with a builder-made packet; new approval/run surfaces call
`assertTaskApprovable`.
