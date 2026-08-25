---
name: WEBEE Native engine migration
description: How an agent moves from Retell to the in-house cascade engine — the deployment-mode flag, shadow testing, the cutover gate, and where native costs come from.
---

## The rule
`WEBEE_NATIVE` is a per-agent flag, nothing more. Flipping `settings.deploymentMode` is the entire cutover; the agent's Retell provisioning is left in place, untouched, so rolling back is the same write with `"RETELL"` and takes effect on the next call. There is no big-bang switch and no code path that migrates a whole workspace.

Consequence: **rollback is never gated.** `setAgentEngine` in `src/lib/voice/shadow/shadow.functions.ts` only runs the readiness checks when moving *to* the native engine. A checklist that could refuse a rollback would be able to trap an agent on a broken engine.

## 1 — Which gateway a call takes is decided by the stored mode, not by the transport
`loadCallAgentConfig` resolves `deploymentMode` from agent settings, and `telephony.gateway.ts` / `frejun.gateway.ts` branch on it: `WEBEE_NATIVE` runs `CascadeSession` at the carrier's native rate (8 kHz Twilio, 16 kHz FreJun), everything else keeps the OpenAI Realtime bridge. One agent's migration therefore cannot affect another's call, even on the same process and the same number pool.

## 2 — The Fish voice id is a separate field from `voiceId`
`settings.webeeVoiceId` holds the Fish Audio model id used as `reference_id`. It exists because `settings.voiceId` holds an OmniVoice id like `11labs-Adrian`, which Fish rejects — and reusing one field would destroy the other engine's voice every time someone switched engines to compare them.

Read order in `graph-agent.ts` is `webeeVoiceId → voice_id → voiceId`; `telephony-core.ts` only reads `webeeVoiceId` for native agents. An unset voice is a working call in Fish's default voice, which is why the checklist warns rather than blocks.

## 3 — Shadow testing replays the graph, not the audio
`replayThroughVm` feeds the caller turns of a real call back through `GraphSession`, so the replay takes the same path as a live call including global-node jumps and transfer edges. No STT, no TTS, no audio: any difference in what the agent says is then attributable to the engine rather than to a different conversation.

Two judgement calls are baked in:

- **Transfers are reported as connected by default.** The reference call was real, so its transfer did connect. Reporting failure would push the replay down the flow's transfer-failed branch and manufacture a divergence.
- **Calls with fewer than two caller turns are skipped, not passed.** A voicemail or an instant hangup has nothing to route on and would otherwise score as perfect parity.

## 4 — Scoring uses bigrams, and structure outranks wording
Two LLM turns almost never match verbatim, so `transcript-diff.ts` scores turns on Dice overlap of word *bigrams*. Word-level overlap scores "yes, tomorrow at three" against "no, not tomorrow at three" as near-identical, and those are opposite answers.

A turn only one side produced is a structural difference: it gets no similarity score, does not dilute the mean, and caps the whole call at `drifting` however well the aligned turns scored. Only a missing reference turn sets `divergedAtTurn` — an *extra* native turn has nothing to diverge from.

## 5 — The checklist distinguishes "cannot work" from "should think about it"
`fail` is reserved for things that make a call impossible: no text LLM key, no TTS provider at all, no runnable conversation graph. Everything else warns — no phone number (web calls still work), batch Whisper instead of Deepgram, thin shadow evidence, unconfigured cost rates. Blocking on thin evidence would make the first agent impossible to migrate, which is the one migration that matters.

## 6 — Native cost is loaded per call, not computed in the gateway
`cost_engine_webee_native` holds four meters instead of Retell's single blended minute, because the cascade bills four. TTS is the only one needing derivation: Fish charges per UTF-8 byte, so the two assumptions that convert bytes to minutes (`tts_chars_per_min`, `agent_talk_ratio`) are stored as editable fields rather than hidden in code, and can be corrected against an invoice.

The maths lives in `src/lib/cost-engine/native-rates.ts` with no imports, because both the admin dashboard and the separately bundled voice gateway need it. `loadNativeCostCentsPerMinute` caches the row and hands the lifecycle a cents-per-minute figure; with no row configured the call reports no cost rather than a wrong one.

Characters are priced as bytes, which holds for ASCII and understates non-Latin scripts — worth remembering before quoting a margin on an Arabic or Hindi deployment.

## 7 — Builder test calls for native agents go through the cascade relay
The dialog's `handleElVoiceTestCall` serves both cascade engines; only the voice catalog differs. For native agents it sends the on-screen exported flow plus the saved `agentId`, so a test call runs the graph VM and reports through the lifecycle — the same path a deployed call takes. Sending only the flattened prompt would test the behaviour the graph VM exists to replace.
