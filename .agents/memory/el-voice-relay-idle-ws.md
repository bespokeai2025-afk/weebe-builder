---
name: EL Voice relay idle WS timeout
description: Why the EL Voice relay WS closes silently mid-call and the fix.
---

## Rule
The EL Voice relay (`el-voice-relay.plugin.ts`) must keep the WebSocket alive with a browser-side ping every 5 s.

**Why:** ElevenLabs streams TTS audio faster than real-time. All audio chunks arrive and get scheduled in the AudioContext's buffer ahead of time. When `response.done` is sent (right after the last audio.delta), `nextPlayTimeRef.current` can be 15+ seconds ahead of `ctx.currentTime`. The drain timer in the browser correctly waits for all audio to finish playing before unmuting the mic. During those ~15 seconds, **neither side sends any WS messages** — the mic gate blocks the browser from sending audio.chunk, and the server is idle. Replit's reverse proxy closes WebSocket connections that carry zero traffic for ~10–15 s, so the WS dies silently before the user even gets to speak.

## Symptom
- Server log: `session.init` then `connection closed` (only 2 lines — no user/agent lines in between).
- Browser log: `mic muted — AI audio started`, then `mic unmuted` ~15 s later, then nothing.
- No `ws.onclose` log visible (because there was no `console.log` in the handler — now fixed).

## Fix (applied)
1. **Browser** (`RetellDeployDialog.tsx`, EL Voice path): `wsPingRef` interval sends `{type:"ping"}` every 5 s from `ws.onopen`, cleared in `cleanupElVoice` and the unmount `useEffect`.
2. **Server** (`el-voice-relay.plugin.ts`): `ping` message handler responds with `{type:"pong"}` via `safeSend` and returns — never passes through VAD.
3. **Observability**: `ws.onclose` now logs `[elv-relay] ws.onclose code=N wasClean=B`; server logs VAD state transitions and `busy` blocks.

## How to apply
Any future WS relay that has a "silent gap" phase (AI speaking, mic gated, no traffic) needs the same keepalive pattern. The ping interval must start on `ws.onopen` (not after getUserMedia) so it covers the begin-message TTS phase too.
