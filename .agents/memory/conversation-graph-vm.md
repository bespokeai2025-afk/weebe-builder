---
name: Conversation graph VM
description: How the in-house voice engine executes builder flows, and the invariants that keep it at Retell parity.
---

## Rule
The conversation graph VM in `src/lib/voice/graph/` is what replaces Retell. Retell's product is not TTS — it is **executing the flow graph at runtime**. Keep the invariants below or agents silently start skipping steps again.

## 1 — The VM consumes the exported Retell flow, not the builder's node shape
`src/lib/voice/graph/load.ts` runs the same `exportAgentJson()` that produces the JSON Retell receives, then executes its `conversationFlow` block. Do not add a second schema path that reads `flow_data.nodes[].data.kind` directly.

**Why:** a native call and a Retell call must interpret byte-identical graphs, otherwise shadow testing compares two different agents. `src/lib/builder/export-conversation-flow.ts` is the semantics reference.

Node type names in the VM are therefore Retell's, not the builder's. The mapping is not 1:1 — the builder's 13 voice kinds collapse into 10 flow types:

| builder kind | flow type |
| --- | --- |
| `conversation` | `conversation` |
| `function`, `check_documents`, `send_upload_link` | `function` (`tool_type: "local"`) |
| `http_request` | `function` (`tool_type: "webhook"`, URL on the node) |
| `call_transfer` | `transfer_call` |
| `agent_transfer` | `agent_swap` |
| `logic_split` | `branch` |
| `extract_variable` | `extract_dynamic_variables` |
| `ending` | `end` |
| `press_digit`, `sms`, `code` | unchanged |

`note` nodes are not exported and must never reach the VM.

## 2 — Every transition is natural language, so routing is a model call
`transition_condition` is always `{ type: "prompt", prompt }`. There is no boolean expression to evaluate. `src/lib/voice/graph/router.ts` is the only place allowed to choose an edge, so the per-turn cost of routing stays visible.

Deterministic short-circuits that must stay:
- a lone edge with an empty condition is taken without any model call;
- DTMF digits match edge text literally first, with a token boundary so digit `1` does not match a condition about `11`;
- a classifier failure falls back to the first *unconditional* edge, not simply the first edge, so an outage cannot strand the call.

Routing and extraction default to `gpt-4.1-mini` (`classifierModel`). Pointing them at the full model is the easiest cost regression to make — these run on every turn.

## 3 — Non-obvious semantics that already caused bugs
- **`end` nodes always export as `instruction.type: "prompt"`**, never `static_text`. The closing line is *generated* from the author's intent, not read verbatim. A test asserting the authored string appears verbatim is wrong.
- **A conversation node whose edges all fail to match takes another turn on the same node.** That is the correct "stay in this step until the condition is met" behaviour, not a dead end.
- **But** if that node has no usable outgoing edges *and* a `return_to_previous` global jump is pending, the VM must unwind the return stack instead. Missing this made global interrupt handlers repeat themselves every turn.
- **The start node can never also be a global node** — it would trap the call in a self-jump. `compileFlow` drops that configuration.
- **`wait_for_result: false`** is fire-and-forget: no `tool_call` directive is emitted and the result cannot influence routing.

## 4 — `code` nodes are deliberately inert
There is no default evaluator for a `code` node's JavaScript. Running flow-authored code in the gateway process is a remote code execution sink. A host must opt in by supplying a sandboxed `runCode` hook; without one the node logs and follows its edge.

## 5 — Directive ordering is the transport's contract
`src/lib/voice/gateway/graph-session.ts` consumes directives strictly in order and awaits each `speak`. Turns are chained through a promise queue, because two overlapping turns would both move the VM's position and produce two agent utterances for one caller turn.

`await_user` is what releases the mic gate — not the end of `speak`. A gateway that unmutes on speak completion will barge over its own audio.

## Where it runs
`src/lib/voice/gateway/cascade.gateway.ts` picks graph mode whenever `session.init` carries an `agentId` or an exported `flow`, and falls back to the flat single-prompt path when the agent has no executable flow. Telephony still runs the flattened prompt through OpenAI Realtime until the telephony-lifecycle phase moves it onto the VM.
