---
name: HyperStream relay pitfalls
description: Four bugs fixed to get the OpenAI Realtime WebSocket relay working in the Vite dev server.
---

## Rule
When touching the HyperStream relay (`hyperstream-relay.plugin.ts`) or `createOpenAIRealtimeSession`, keep these four fixes in place.

**Why:** Each was a silent failure that looked like "call hangs up immediately."

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

## 4 — Binary frames
The `ws` library receives all WebSocket messages as `Buffer` even when the original was a text frame.
Forwarding `openaiWs.send(data)` with a Buffer sends a **binary** frame.
OpenAI Realtime rejects binary frames with `invalid_event`.
Fix:
```typescript
browserWs.on("message", (data: RawData, isBinary: boolean) => {
  openaiWs.send(data, { binary: isBinary });
});
```

## How to apply
Any time the relay plugin or session creator is modified, verify all four points above are still in place before testing.
