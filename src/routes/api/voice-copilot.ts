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
  "CREATE_NODE",
  "CONNECT_NODES",
  "UPDATE_NODE_PROPERTIES",
  "CREATE_TRANSITIONS",
  "UPDATE_GLOBAL_SETTINGS",
]);

// ─────────────────────────────────────────────────────────────────────────────
// System prompt — comprehensive command dictionary
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are WEBEE Builder Copilot. Convert voice instructions into a JSON command array for an AI voice agent canvas builder.

═══ NODE TYPE REGISTRY ═══

Map synonyms → type exactly as shown:

• conversation — say, speak, greet, talk, add conversation, message, add a prompt, add speech, ask the caller
• function      — run function, check availability, trigger API, call action, execute integration, tool call
• call_transfer — transfer call, forward to, forward number, dial out, redirect call, send to number
• press_digit   — press key, dtmf, gather digit, ivr menu, press button, keypad input
• logic_split   — conditional, branching, if else, route intent, split path, depends on, based on, check if
• agent_transfer — send to human, hand off to live agent, escalate, transfer to operator, live agent
• sms           — send text message, text during call, sms link, send SMS, send a text
• extract_variable — save response, capture data, extract var, remember what they said, store answer, record value
• code          — custom script, javascript, run code block, code snippet, execute code
• ending        — hang up, terminate, goodbye node, stop call, end call, end the call
• note          — sticky note, comment on canvas, remind me, canvas note, annotation

═══ COMMAND SHAPES ═══

1. CREATE_NODE — create a new node on the canvas
{
  "action": "CREATE_NODE",
  "type": "<nodeType>",
  "label": "<short descriptive title>",
  "dialogue": "<optional: agent instructions or content>",
  "properties": {
    "phone_number": "<for call_transfer>",
    "sms_body": "<for sms>",
    "variable_name": "<for extract_variable>",
    "function_name": "<for function>",
    "code_snippet": "<for code>"
  },
  "_ref": "<short unique id, e.g. n1, n2 — used by CONNECT_NODES in same batch>"
}

2. CONNECT_NODES — draw a wire between two nodes
{
  "action": "CONNECT_NODES",
  "from": "<node label, _ref, or node id>",
  "to": "<node label, _ref, or node id>",
  "via_transition": "<optional: exact transition/option label to use as source handle>"
}

3. UPDATE_NODE_PROPERTIES — modify an existing node's content or settings
{
  "action": "UPDATE_NODE_PROPERTIES",
  "node": "<node label or id — use fuzzy match>",
  "properties": {
    "title": "<new label>",
    "text": "<new dialogue/instructions>",
    "phone_number": "<for call_transfer>",
    "sms_body": "<for sms>",
    "variable_name": "<for extract_variable>",
    "function_name": "<for function>",
    "code_snippet": "<for code>"
  }
}

4. CREATE_TRANSITIONS — add branching options/paths to a node
{
  "action": "CREATE_TRANSITIONS",
  "node": "<node label or id>",
  "transitions": ["<option label 1>", "<option label 2>", ...]
}

5. UPDATE_GLOBAL_SETTINGS — update side-panel agent settings (no canvas changes)
{
  "action": "UPDATE_GLOBAL_SETTINGS",
  "agentName": "<optional>",
  "globalPrompt": "<optional>",
  "language": "<optional: BCP-47 code — map natural language: 'GB English'→'en-GB', 'US English'→'en-US', 'Spanish'→'es-ES', 'French'→'fr-FR', 'German'→'de-DE', 'Portuguese'→'pt-PT', 'Italian'→'it-IT', 'Dutch'→'nl-NL', 'Japanese'→'ja-JP', 'Chinese'→'zh-CN', 'Korean'→'ko-KR'>",
  "voiceId": "<optional: map 'Adrian'→'11labs-Adrian', keep other voice names as-is>",
  "model": "<optional: map 'GPT-4o'→'gpt-4o', 'GPT-4o mini'→'gpt-4o-mini', 'GPT-4.1'→'gpt-4.1', 'GPT-4'→'gpt-4'>"
}

═══ EXECUTION RULES ═══

1. CHAIN: Execute multiple commands in a single batch array. If user says "Create a greeting node, add two options, and connect it to a logic split", output all required commands in sequence.

2. FUZZY NAMES: When a command references an existing node by name (e.g. "connect to the booking node"), match it by the closest label — don't require exact spelling. Use the node label string, not an ID.

3. REFS: Assign _ref values (n1, n2, etc.) to every CREATE_NODE. Use those refs in subsequent CONNECT_NODES or CREATE_TRANSITIONS within the same batch.

4. PROPERTIES: Always populate relevant properties for the node type:
   - conversation → dialogue (agent instructions)
   - call_transfer → properties.phone_number
   - sms → properties.sms_body
   - extract_variable → properties.variable_name
   - function → properties.function_name
   - code → properties.code_snippet
   - note → dialogue (content)

5. STRICT: Reject any command that isn't one of the 5 actions above. Return { "commands": [] } if the request is not about the builder.

Return ONLY valid JSON — no markdown, no code fences, no explanation.`;

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
        try {
          const body = (await request.json()) as { audio: string; mimeType: string };
          audio = body.audio;
          mimeType = body.mimeType ?? "audio/webm";
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
        const blob = new Blob([audioBuffer], { type: mimeType });
        formData.append("file", blob, `audio.${ext}`);
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
          const data = (await whisperRes.json()) as { text?: string };
          transcript = (data.text ?? "").trim();
        } catch (e) {
          console.error("[VoiceCopilot] Whisper fetch error:", e);
          return json({ ok: false, error: "Transcription request failed" }, 502);
        }

        if (!transcript) return json({ ok: false, error: "Could not transcribe audio" }, 422);

        // ── 3. Parse commands via GPT-4o-mini ─────────────────────────────────
        let commands: unknown[] = [];
        try {
          const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              temperature: 0,
              max_tokens: 1500,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: transcript },
              ],
            }),
          });
          if (!gptRes.ok) {
            console.error("[VoiceCopilot] GPT error:", await gptRes.text());
            return json({ ok: false, error: "Command parsing failed" }, 502);
          }
          const gptData = (await gptRes.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const raw = gptData.choices?.[0]?.message?.content ?? "{}";
          const parsed = JSON.parse(raw) as { commands?: unknown[] };
          commands = Array.isArray(parsed.commands) ? parsed.commands : [];
        } catch (e) {
          console.error("[VoiceCopilot] GPT parse error:", e);
          return json({ ok: false, error: "Command parsing failed" }, 502);
        }

        // ── 4. Sanitise — strip unknown actions / node types ──────────────────
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
