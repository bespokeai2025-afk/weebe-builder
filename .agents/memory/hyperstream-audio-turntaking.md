---
name: HyperStream (OpenAI Realtime) browser audio & turn-taking
description: Why browser HyperStream calls skip steps, talk over the caller, or sound jittery, and the non-obvious fixes.
---

Browser-based OpenAI Realtime test calls had three linked failure modes. The fixes
are not discoverable from the API docs alone:

- **Agent skips script steps / reads everything in one breath.**
  A single flattened instruction string is NOT a state machine. The model must be
  *told* to pace itself. The compiled prompt now prepends explicit turn-taking
  rules ("one step per turn", "stop and WAIT for the caller", "never combine
  steps"). Without these the model races through the whole script.
  **How to apply:** any flow→prompt compiler for a realtime LLM voice agent needs
  hard turn-taking rules up top, not just the script.

- **Agent doesn't wait for the caller's response.**
  `turn_detection: server_vad` cuts people off on a fixed silence timer. Switch to
  `{ type: "semantic_vad", eagerness: "low" }` (nested under
  `session.audio.input.turn_detection`) so a model decides when the caller is
  actually done. `low` eagerness = waits longer before taking the turn.

- **Laggy / jittery / mis-heard audio = capture sample-rate mismatch.**
  `new AudioContext({ sampleRate: 24000 })` is a *request* the browser may ignore
  (it can stay at 48 kHz). If capture samples are sent to OpenAI declared as 24 kHz
  but are really 48 kHz, the model hears garbled/half-speed audio → mishears →
  skips/doesn't wait, and playback is rough. The AudioWorklet capture processor
  must resample to a guaranteed 24 kHz using the worklet-global `sampleRate`
  (`ratio = sampleRate/24000`), with a fractional cursor AND the previous block's
  last sample carried across `process()` calls so interpolation stitches across
  128-frame block boundaries. Always log `audioCtx.sampleRate` to confirm.
  **Why:** mic capture moved off-thread to an AudioWorklet (main-thread
  ScriptProcessorNode dropped frames); resampling lives in that same worklet.
