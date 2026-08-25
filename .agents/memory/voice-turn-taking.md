---
name: Voice turn-taking and barge-in
description: How full-duplex interruption, VAD and streaming STT fit together in the cascade engine, and the traps in each.
---

## Rule
The cascade gateway (`src/lib/voice/gateway/cascade.gateway.ts`) is full duplex. Mic audio keeps flowing while the agent speaks. Do not reintroduce a mic gate — that is what removed barge-in in the first place.

## 1 — Barge-in needs three things to happen together
Cancelling only one of these leaves the agent talking over the caller:

1. **Abort the work** — the turn's `AbortController` stops the LLM mid-generation and breaks the TTS loop. Breaking out of the `for await` also returns the generator, which closes the provider's upstream socket instead of leaving it billing for audio nobody will hear.
2. **Send `audio.clear`** — the browser has already buffered audio the relay cannot recall. Without this the agent keeps speaking for seconds after being interrupted.
3. **Drop the browser's queue** — the client stops every scheduled `AudioBufferSourceNode` and resets `nextPlayTimeRef`. Stopping future scheduling is not enough; Web Audio nodes already started will play to completion.

## 2 — A single loud frame must not count as an interrupt
`BARGE_IN_SPEECH_FRAMES` requires sustained speech (~6 frames) before cutting the agent off. Browser echo cancellation is imperfect, and a false interrupt is worse than a slightly late one because it truncates the agent mid-sentence for no reason.

## 3 — `await_user` releases the mic gate, not the end of speech
The graph session (`graph-session.ts`) emits `await_user` after a node finishes. A gateway that opens the gate when `speak` resolves will barge over its own trailing audio.

## 4 — VAD: fixed thresholds cannot work, and the fix has two traps
The original detector used `RMS_THRESHOLD = 400`. There is no fixed value that works: on a noisy line the room itself clears 400 and the agent hears continuous speech, while a quiet speaker on a good headset never reaches it.

`EnergyVad` estimates the floor as **the minimum of recent frame energies**, not an average of frames classified as silence. An average gated on "not speech" can be poisoned by its own misclassification and then never recovers — once it wrongly latches onto steady noise as an utterance, it stops adapting. A minimum cannot get stuck that way, because speech has gaps.

Two traps that both produced real bugs:

- **Cold start.** With no floor measured yet, a call that opens on a noisy line latches onto the noise immediately. Hence `warmupFrames`: speech detection is suppressed for the first ~10 frames while the floor is measured. The caller is not talking during the agent's greeting anyway.
- **Long utterances.** If the threshold keeps tracking during a turn, a long sentence drags the floor up to the speaker's own level until their voice reads as silence and the turn ends mid-word. Hence the threshold is **frozen at onset** and released when the utterance closes.

## 5 — Endpointing details that matter more than they look
`Endpointer` in `src/lib/voice/vad/types.ts` is shared by every backend, so turn timing does not change with the detector.

- **Hangover is added to every single turn.** `silenceFramesTrigger` is the first knob to look at when turns feel slow, ahead of any model choice.
- **Pre-roll is not optional.** Without frames from before detection, the onset consonant is clipped and transcription quality drops. The ring is never smaller than `startFrames - 1`, because the frames that made up the opening run *are* speech and must survive.
- **The triggering frame is always kept.** An earlier version built the utterance from the pre-roll ring alone, so configuring zero pre-roll silently dropped the frame that opened the turn.
- **`maxUtteranceFrames`** force-closes a runaway utterance. Without it an open mic buffers without bound.

## 6 — Streaming STT is where the latency budget is won
With batch Whisper the whole transcription happens *after* end-of-speech and lands on the critical path, which alone can blow the sub-800 ms target. Deepgram transcribes as audio arrives, so at endpoint only a flush round-trip remains.

Both sit behind `SttProvider` in `src/lib/voice/stt/`. Callers always do both — `push` every frame and `finalizeUtterance(frames)` — because a streaming provider ignores the frames it is handed and a batch provider ignores the pushes. Deepgram's `finalizeUtterance` must not re-send the audio; it was already streamed.

Deepgram's flush needs a timeout with an interim-text fallback: a slightly rough transcript beats dropping the caller's turn.

## 7 — Silero is optional on purpose
`onnxruntime-node` unpacks to ~270 MB of native binaries. Forcing that into every deploy for one classifier is a bad trade, so `createVad()` prefers Silero when both the runtime and `SILERO_VAD_MODEL_PATH` are present and uses the energy detector otherwise. Because endpointing is shared, switching backends does not change turn timing.

## 8 — Frames must reach a VAD in order
A VAD is a state machine and a neural detector's `push` is async. The gateway chains frames through a promise (`framePump`) rather than racing them; processing frame N+1 before frame N corrupts endpointing.

## Latency instrumentation
Every turn logs `endpoint→stt`, `stt→audio` and `total`, flagged `OVER BUDGET` past 800 ms. Use those numbers rather than guessing which stage regressed.
