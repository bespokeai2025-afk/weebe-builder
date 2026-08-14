---
name: Native voice call lifecycle
description: How the native engine reports calls as Retell-shaped webhook events, and the ordering and shape rules that keep downstream automation working.
---

## The rule
The native engine does not write to `calls`, leads, CRM, bookings or analytics. It POSTs Retell-shaped events to `/api/public/voice-webhook` and lets `retell-webhook.processor.ts` fan them out. Code lives in `src/lib/voice/lifecycle/`.

This is why: that processor is ~1335 lines and WBAH, CRM dispatch, lead-gen, calendar, executive events and the dedup ledger all key off Retell's payload. Emitting the same shape inherits all of it. Writing our own persistence would mean reimplementing every one of those integrations.

The payload shape in `lifecycle/types.ts` is therefore a **contract**. Renaming a field silently disables a downstream feature — nothing fails loudly, the data just stops arriving.

## 1 — `call_ended` must be delivered before `call_analyzed`
Both events upsert the same `calls` row, and the upsert always writes `call_summary`, `sentiment`, `call_successful` and `in_voicemail` from `call.call_analysis`, using null when it is absent. `call_ended` carries no analysis. If it lands second it overwrites the analysis with nulls.

So `ended()` awaits the `call_ended` delivery before starting the analysis pass. Everything else is fire-and-forget.

## 2 — `resolveAgent` had to learn a third id
Native calls have no Retell agent, so they identify themselves with the WEBEE `agents.id` UUID. `resolveAgent()` in the processor matches that in addition to `retell_agent_id` and `settings.deployedRetellAgentId`. The namespaces cannot collide: Retell ids are always `agent_<hex>`.

A call with no agent id is never emitted at all — the processor could only answer "unknown agent", so the request is pure overhead.

## 3 — Disconnection reasons must use Retell's vocabulary
Downstream code pattern-matches these strings. `no_answer`/`busy`/`voicemail` drive lead no-answer handling, and the voicemail classifier keyword-matches the reason text. A reason we invent instead of reusing quietly disables both paths.

## 4 — Events are delivered over loopback
`resolveWebhookUrl()` prefers `http://127.0.0.1:<port>` using the port the gateway learned from the HTTP server it mounted on (`registerLocalHttpServer`). Loopback cannot be broken by proxy, TLS or DNS, and in a sandbox the public hostname often does not resolve from inside the box.

Signing only happens when `RETELL_SIGNATURE_VERIFICATION_ENABLED === "true"`, using `RETELL_API_KEY` because that is the first key the verifier tries. A deployment that enables verification without that key would 403 every native event, so that combination logs an explicit error rather than failing silently.

## 5 — Recording: caller and agent audio need different placement
`CallRecorder` mixes both directions into one mono 8 kHz WAV.

- **Caller audio is placed by arrival time.** It arrives in real time, so the wall clock is its true position.
- **Agent audio is not.** TTS streams a whole utterance in a burst well ahead of playback, so placing it by arrival would compress speech into a fraction of its real duration. Agent chunks are laid down contiguously from where the utterance began and only re-synced to the clock when a gap means a new utterance started.
- **Barge-in must call `agentStoppedSpeaking()`.** Otherwise the cursor stays parked past audio the caller never heard, and the next reply lands after silence that never happened.

8 kHz is chosen because the mix is held in RAM until the call ends: at 24 kHz a half-hour call needs 86 MB and exceeds the bucket's 50 MB object limit. Speech is unharmed — it is what the PSTN itself delivers.

## 6 — Analysis has to be structurally aware, not just keyword-driven
Voicemail detection combines keywords with call shape: **exactly one user turn** for the whole call. A machine talks once and never takes another turn; a human who says "I can leave a message for him" takes several. Keywords alone flag the human.

Other rules that exist for a reason:
- **No user speech means no LLM call.** There is nothing to summarise, and this is the highest-volume call type there is.
- **`call_successful` is null, never false, when unknown.** False marks a real campaign contact as a failed outcome.
- **Unrequested `custom_analysis_data` keys are dropped.** Booking and CRM mappers look fields up by name, so a hallucinated `appointment_date` would be acted on.
- Types are coerced (`"true"`, `"4 people"`, `"Positive."`) because these values go straight into typed Postgres columns.

The extraction schema comes from `readAnalysisSchema()`, which reads both `settings.rawAgent.post_call_analysis_data` (imported agents) and `settings.variables` (builder-built agents), since only the exporter normally bridges the two.

## 7 — Transcript assembly is not cosmetic
Streaming STT emits several finals per spoken sentence and the VM speaks a node in fragments. Unmerged, a transcript reads as dozens of one-word turns, which wrecks the analysis prompt and the transition-condition classifier — that classifier reasons over "what the user just said" as one message. `mergeTurns()` collapses consecutive same-role turns and is used by every representation, so the text blob and `transcript_object` can never disagree.

## 8 — Numbers are provisioned directly on Twilio
`src/lib/telephony/twilio-numbers.server.ts` replaces Retell's phone APIs. The reason is not cost: a number bought through Retell can only point at a Retell agent, which makes the native engine unreachable on it.

Every provisioned number gets `voiceUrl` set to `/api/public/telephony/inbound`. That single field is what connects a call to the gateway; without it the number rings and plays Twilio's default message. Assignment re-applies the webhooks because a Voice URL edited in the Twilio console would otherwise leave the number silently disconnected while the UI showed it as assigned.

`twilio` is CommonJS (`export =`): the callable factory is on `.default` at runtime, but the types describe the bare namespace. Calling the namespace directly typechecks and fails at runtime.
