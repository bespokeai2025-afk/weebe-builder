---
name: Business DNA knowledge-base upload wiring
description: How KB doc uploads on the Business DNA pages feed both GrowthMind's RAG and the DNA auto-discovery engine.
---

Both Business DNA UIs (HiveMind's AI-discovery page and GrowthMind's manual-form page) share one
reusable upload widget that always targets the workspace's `growthmind` executive KB slug via the
existing generic executive-knowledge server fns — no new tables/migrations, no per-workspace
special-casing.

**Why:** GrowthMind already has read access to the `growthmind`+`shared` executive KBs
(`EXECUTIVE_KNOWLEDGE_ACCESS`), so routing uploads there automatically makes them part of
GrowthMind's own RAG retrieval for free. The DNA discovery engine (`runDnaDiscovery`) previously
claimed "knowledge bases" as a discovery source in its UI copy but never actually read any —
it now pulls recent `executive_document_chunks` for those KB ids and injects them into the GPT
prompt as authoritative first-party evidence (confidence 80-100), tracked via a
`kb_docs_analysed` count in `discovery_sources`.

**How to apply:** any future "upload docs to inform X" feature for an executive (SystemMind,
HiveMind, GrowthMind) should reuse this same pattern — target the executive's own KB slug through
`executive-knowledge.functions.ts`, rather than inventing a parallel upload/storage path.
