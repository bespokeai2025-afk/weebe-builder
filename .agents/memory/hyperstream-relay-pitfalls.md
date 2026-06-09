---
name: HyperStream relay pitfalls
description: Bugs fixed to get the OpenAI Realtime WebSocket relay working in the Vite dev server.
---

## Rule
When touching the HyperStream relay (`hyperstream-relay.plugin.ts`) or `createOpenAIRealtimeSession`, keep these fixes in place.

**Why:** Each was a silent failure that looked like "call hangs up immediately" or "agent never responds to user speech."

## 1 — Model name (as of June 2026)
Old model `gpt-4o-realtime-preview-2024-12-17` no longer exists.
Current model: `gpt-realtime` (undated stable alias).
`createOpenAIRealtimeSession` in `agents.functions.ts` must use the same name.

## 2 — Beta header removed
`OpenAI-Beta: realtime=v1` now causes `4000 beta_api_shape_disabled`.
Remove it from both the relay plugin and the session creator.

## 3 — Synchronous upgrade handler
The `httpServer.on("upgrade", ...)` handler **must not** `await` anything before calling `wss.handleUpgrade(...)`.
If the upgrade handler is `async` and awaits (e.g. `await import("ws")`), Replit's reverse proxy drops the socket before `handleUpgrade` runs.
Fix: import `ws` at the top level of the plugin file so the handler stays synchronous.

## 4 — Binary frames (BOTH directions — this is the subtle one)
The `ws` library hands every message to its `message` listener as a `Buffer`, even when the peer sent a TEXT frame. If you then `.send(buffer)` without `{ binary: false }`, ws re-emits it as a BINARY frame. So a relay that blindly forwards `Buffer` payloads silently converts every text frame to binary.
- Browser → OpenAI: binary frame → OpenAI rejects with `invalid_event`.
- OpenAI → browser: binary frame → arrives in the browser as a `Blob`/`ArrayBuffer`, and `JSON.parse(ev.data)` throws and (if wrapped in try/catch) is silently dropped — `session.created`/`session.updated`/audio deltas all vanish. Symptom: only `relay.connected` (which the relay sends as a real JS string) is ever parsed; the call configures then hangs and closes 1005.
Fix — forward with the original frame type in BOTH directions using the `isBinary` arg:
```typescript
openaiWs.on("message", (data, isBinary) => browserWs.send(data, { binary: isBinary }));
browserWs.on("message", (data, isBinary) => openaiWs.send(data, { binary: isBinary }));
```
Defensive belt-and-suspenders on the browser: set `ws.binaryType = "arraybuffer"` and decode non-string frames with `TextDecoder` before `JSON.parse`.

## 5 — session.update exact schema for gpt-realtime (confirmed from session.created)
The `gpt-realtime` model uses a **nested** `audio.input` / `audio.output` structure — the opposite of the public OpenAI Realtime API flat schema. Fields sent outside this shape are rejected with `unknown_parameter`. `session.type` is also **required** on every update.

Confirmed from parsing the full `session.created` payload:
- `output_modalities` (not `modalities`, not `input_audio_format`/`output_audio_format`)
- `audio.input.turn_detection` — nested, NOT top-level
- `audio.output.voice` — nested, NOT top-level
- Format is `{ type: "audio/pcm", rate: 24000 }` (not `"pcm16"` string)

**Correct shape**:
```json
{
  "type": "session.update",
  "session": {
    "type": "realtime",
    "output_modalities": ["audio"],
    "instructions": "...",
    "audio": {
      "input": {
        "turn_detection": {
          "type": "server_vad",
          "threshold": 0.5,
          "prefix_padding_ms": 300,
          "silence_duration_ms": 600,
          "create_response": true,
          "interrupt_response": true
        }
      },
      "output": { "voice": "alloy" }
    }
  }
}
```

`server_vad` is the confirmed valid type; `semantic_vad` may not be supported by this model.

## How to apply
Any time the relay plugin or session creator is modified, verify all five points above are still in place before testing.
