import { createFileRoute } from "@tanstack/react-router";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const VALID_TYPES = new Set([
  "conversation", "function", "call_transfer", "press_digit",
  "logic_split", "agent_transfer", "sms", "extract_variable",
  "code", "ending", "note",
]);

const VALID_ACTIONS = new Set([
  "CREATE_NODE", "CONNECT_NODES", "UPDATE_NODE_PROPERTIES",
  "CREATE_TRANSITIONS", "UPDATE_GLOBAL_SETTINGS",
  "REMOVE_TRANSITION", "DISCONNECT_NODES",
]);

const SYSTEM_PROMPT = `You are WEBEE Builder Copilot. Convert voice instructions into a structured JSON object for an AI voice agent canvas builder.

═══ REQUIRED OUTPUT SHAPE ═══
Always output a JSON object with TWO keys:
1. "thought" — a 1-2 sentence reasoning: identify what the user wants, which nodes are targeted, and verify they exist in CURRENT CANVAS NODES.
2. "commands" — an array of executable command objects.

Example output:
{"thought":"User wants an end node for goodbyes. No existing ending node matches this.","commands":[{"action":"CREATE_NODE","type":"ending","label":"Goodbye Handler","_ref":"n1"}]}

═══ NODE TYPE REGISTRY (synonyms → type) ═══
conversation   — say, speak, greet, talk, message, add conversation, prompt, ask
function       — run function, check availability, trigger API, call action, execute integration, tool
call_transfer  — transfer call, forward to, forward number, dial out, redirect call
press_digit    — press key, dtmf, gather digit, ivr menu, keypad input
logic_split    — conditional, branching, if else, route intent, split path, check if, based on, depends
agent_transfer — send to human, hand off to live agent, escalate, operator, live agent
sms            — send text message, text during call, SMS, send a text
extract_variable — save response, capture data, extract var, remember what they said, store answer
code           — custom script, javascript, run code block, run script
ending         — hang up, terminate, goodbye, stop call, end call, end the call, stop workflow
note           — sticky note, canvas comment, annotation, remind me

═══ COMMANDS ═══

1. CREATE_NODE
{"action":"CREATE_NODE","type":"<type>","label":"<short title>","dialogue":"<agent instructions>","properties":{"phone_number":"","sms_body":"","variable_name":"","function_name":"","code_snippet":""},"_ref":"n1"}

2. CONNECT_NODES  (reference by _ref or exact label from CURRENT CANVAS NODES)
{"action":"CONNECT_NODES","from_node_id":"<_ref or node label>","to_node_id":"<_ref or node label>","via_transition":"<optional: transition label to route through>","transition_label":"<optional: label for the new wire>"}

3. UPDATE_NODE_PROPERTIES  (fuzzy-match node by label)
{"action":"UPDATE_NODE_PROPERTIES","node":"<label>","properties":{"title":"","text":"","phone_number":"","sms_body":"","variable_name":"","function_name":"","code_snippet":""}}

4. CREATE_TRANSITIONS  (add branching option handles to a node)
{"action":"CREATE_TRANSITIONS","node":"<label>","transitions":["option 1","option 2"]}

5. UPDATE_GLOBAL_SETTINGS
{"action":"UPDATE_GLOBAL_SETTINGS","agentName":"","globalPrompt":"","language":"<BCP-47: en-US,en-GB,es-ES,fr-FR,de-DE,pt-PT,ja-JP,zh-CN>","voiceId":"<e.g. 11labs-Adrian>","model":"<gpt-4o|gpt-4o-mini|gpt-4.1>"}

6. REMOVE_TRANSITION  (delete a transition handle AND its wire from a node)
{"action":"REMOVE_TRANSITION","node":"<node label>","transition":"<transition label>"}

7. DISCONNECT_NODES  (remove the wire(s) between two nodes; keeps the transition handles)
{"action":"DISCONNECT_NODES","from_node_id":"<label or _ref>","to_node_id":"<label or _ref>"}

═══ FEW-SHOT EXAMPLES ═══

Input: "Oh wait, can you make a box that says goodbye if they hang up?"
{"thought":"User wants an ending node for goodbye scenarios. No existing ending node covers this.","commands":[{"action":"CREATE_NODE","type":"ending","label":"Goodbye Handler","dialogue":"Thank you for calling. Goodbye!","_ref":"n1"}]}

Input: "Link the booking button to that check availability thing we just made."
{"thought":"User wants to connect the Booking transition path to the Check Availability node. Both exist on canvas.","commands":[{"action":"CONNECT_NODES","from_node_id":"Welcome Node","via_transition":"Booking","to_node_id":"Check Availability"}]}

Input: "Add a greeting node that asks for the caller's name, then a logic split that checks if they want support or sales, and connect them."
{"thought":"Create a conversation node for greeting, a logic split for routing, then wire them together.","commands":[{"action":"CREATE_NODE","type":"conversation","label":"Greeting","dialogue":"Hello! Could I get your name please?","_ref":"n1"},{"action":"CREATE_NODE","type":"logic_split","label":"Support or Sales","_ref":"n2"},{"action":"CONNECT_NODES","from_node_id":"n1","to_node_id":"n2","transition_label":"Continue"}]}

Input: "Change the phone number in the transfer node to +1 800 555 0199"
{"thought":"User wants to update the phone_number property on the existing Call Transfer node.","commands":[{"action":"UPDATE_NODE_PROPERTIES","node":"Call Transfer","properties":{"phone_number":"+18005550199"}}]}

Input: "Set the agent name to Aria and switch the model to GPT-4o"
{"thought":"User wants to update global agent settings — name and model.","commands":[{"action":"UPDATE_GLOBAL_SETTINGS","agentName":"Aria","model":"gpt-4o"}]}

Input: "Remove the Continue transition from the Start Call node"
{"thought":"User wants to delete the 'Continue' transition handle (and its wire) from 'Start Call'. That transition exists on the node per CURRENT CANVAS NODES.","commands":[{"action":"REMOVE_TRANSITION","node":"Start Call","transition":"Continue"}]}

Input: "Disconnect Start Call from End Call"
{"thought":"User wants to remove the wire between 'Start Call' and 'End Call' but keep the transition handles. Both nodes exist.","commands":[{"action":"DISCONNECT_NODES","from_node_id":"Start Call","to_node_id":"End Call"}]}

═══ RULES ═══
- ALWAYS emit "thought" before "commands"
- Use _ref (n1, n2…) on every CREATE_NODE; reference same _ref in CONNECT_NODES within the same batch
- When referencing EXISTING canvas nodes, use their exact label from CURRENT CANVAS NODES (fuzzy match acceptable)
- Chain all commands in one array for multi-step instructions — never split across responses
- For conversation nodes, write natural brief agent instructions in dialogue
- EXISTING TRANSITIONS: each node lists its transitions in CURRENT CANVAS NODES. When the user says "connect via [name]" or "use the [name] transition", look up that node's transition list and set via_transition to the EXACT existing label. Do NOT emit CREATE_TRANSITIONS or a new transition_label if a matching transition already exists on the source node.
- REMOVE vs DISCONNECT: use REMOVE_TRANSITION when the user wants to delete a specific named transition handle (e.g. "delete the Connect transition", "remove that option"). Use DISCONNECT_NODES when the user wants to remove the wire/connection between two nodes but keep the handles (e.g. "disconnect A from B", "unlink those two nodes", "remove the connection between X and Y").
- Return {"thought":"Not a builder command.","commands":[]} if the request is off-topic
- Return ONLY valid JSON — no markdown, no code fences`;

export const Route = createFileRoute("/api/voice-copilot")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          return json({ ok: false, error: "OPENAI_API_KEY is not configured" }, 500);
        }

        let audio: string;
        let mimeType: string;
        let canvasNodes: { id: string; label: string; kind: string; transitions: { id: string; label: string }[] }[] = [];

        try {
          const body = (await request.json()) as {
            audio: string;
            mimeType: string;
            canvasNodes?: { id: string; label: string; kind: string; transitions: { id: string; label: string }[] }[];
          };
          audio = body.audio;
          mimeType = body.mimeType ?? "audio/webm";
          canvasNodes = body.canvasNodes ?? [];
        } catch {
          return json({ ok: false, error: "Invalid request body" }, 400);
        }

        if (!audio) return json({ ok: false, error: "No audio provided" }, 400);

        // ── 1. Decode base64 audio ────────────────────────────────────────────
        let audioBuffer: Buffer;
        try {
          audioBuffer = Buffer.from(audio, "base64");
        } catch {
          return json({ ok: false, error: "Failed to decode audio" }, 400);
        }

        // ── 2. Transcribe via Whisper ─────────────────────────────────────────
        const formData = new FormData();
        const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
        formData.append("file", new Blob([audioBuffer], { type: mimeType }), `audio.${ext}`);
        formData.append("model", "whisper-1");
        formData.append("language", "en");

        let transcript: string;
        try {
          const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: formData,
          });
          if (!whisperRes.ok) {
            console.error("[VoiceCopilot] Whisper error:", await whisperRes.text());
            return json({ ok: false, error: "Transcription failed" }, 502);
          }
          transcript = ((await whisperRes.json() as { text?: string }).text ?? "").trim();
        } catch (e) {
          console.error("[VoiceCopilot] Whisper fetch error:", e);
          return json({ ok: false, error: "Transcription request failed" }, 502);
        }

        if (!transcript) return json({ ok: false, error: "Could not transcribe audio" }, 422);

        // ── 3. Build user message with canvas context ─────────────────────────
        const canvasContext =
          canvasNodes.length > 0
            ? `CURRENT CANVAS NODES:\n${canvasNodes.map((n) => {
                const tList = n.transitions.length > 0
                  ? ` | transitions: [${n.transitions.map((t) => `"${t.label}"`).join(", ")}]`
                  : "";
                return `- "${n.label}" (id: ${n.id}, type: ${n.kind})${tList}`;
              }).join("\n")}\n\n`
            : "CURRENT CANVAS NODES: (empty canvas)\n\n";

        const userMessage = `${canvasContext}USER COMMAND: ${transcript}`;

        // ── 4. Parse commands via GPT-4o ──────────────────────────────────────
        let commands: unknown[] = [];
        try {
          const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o",
              temperature: 0,
              max_tokens: 1500,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: userMessage },
              ],
            }),
          });
          if (!gptRes.ok) {
            console.error("[VoiceCopilot] GPT error:", await gptRes.text());
            return json({ ok: false, error: "Command parsing failed" }, 502);
          }
          const raw =
            ((await gptRes.json() as { choices?: { message?: { content?: string } }[] })
              .choices?.[0]?.message?.content) ?? "{}";
          const parsed = JSON.parse(raw) as { thought?: string; commands?: unknown[] };
          if (parsed.thought) console.log("[VoiceCopilot] CoT:", parsed.thought);
          commands = parsed.commands ?? [];
        } catch (e) {
          console.error("[VoiceCopilot] GPT parse error:", e);
          return json({ ok: false, error: "Command parsing failed" }, 502);
        }

        // ── 5. Sanitise ───────────────────────────────────────────────────────
        const safe = commands.filter((c) => {
          if (typeof c !== "object" || c === null) return false;
          const cmd = c as Record<string, unknown>;
          if (!VALID_ACTIONS.has(cmd.action as string)) return false;
          if (cmd.action === "CREATE_NODE" && !VALID_TYPES.has(cmd.type as string)) return false;
          return true;
        });

        return json({ ok: true, transcript, commands: safe });
      },
    },
  },
});
