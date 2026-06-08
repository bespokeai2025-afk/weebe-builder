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
  "conversation",
  "function",
  "call_transfer",
  "press_digit",
  "logic_split",
  "agent_transfer",
  "sms",
  "extract_variable",
  "code",
  "ending",
  "note",
]);

const SYSTEM_PROMPT = `You are WEBEE Builder Copilot. Convert the user's voice instruction into canvas commands for an AI voice agent builder.

Valid node types: conversation | function | call_transfer | press_digit | logic_split | agent_transfer | sms | extract_variable | code | ending | note

Node type guidance:
- conversation: the agent speaks and listens (most common)
- logic_split: branching based on conditions (use for "if", "depends", "based on")
- ending: terminates the call
- call_transfer: transfer call to a phone number
- press_digit: wait for DTMF keypress
- sms: send an SMS during the call
- extract_variable: extract information from the conversation
- function: call an external tool/API
- note: canvas annotation only, not executed

Return ONLY a JSON object — no markdown, no explanation, no code fences:
{
  "commands": [
    { "action": "CREATE_NODE", "type": "<nodeType>", "label": "<short label>", "dialogue": "<optional text/instructions>", "_ref": "<short unique id like n1, n2>" },
    { "action": "CONNECT_NODES", "from": "<_ref or existing node id>", "to": "<_ref or existing node id>" },
    { "action": "UPDATE_NODE", "nodeId": "<existing node id>", "label": "<label>", "dialogue": "<text>" },
    { "action": "UPDATE_SETTINGS", "agentName": "<name>", "globalPrompt": "<prompt>" }
  ]
}

Rules:
- Use _ref values to cross-reference nodes created in the same response when using CONNECT_NODES
- For conversation nodes, write brief natural agent instructions in dialogue (e.g. "Ask the caller for their name and reason for calling")
- Always output valid JSON — never wrap in markdown
- Return { "commands": [] } if the instruction is unclear or not a builder command`;

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

        if (!audio) {
          return json({ ok: false, error: "No audio provided" }, 400);
        }

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
            const err = await whisperRes.text();
            console.error("[VoiceCopilot] Whisper error:", err);
            return json({ ok: false, error: "Transcription failed" }, 502);
          }
          const data = (await whisperRes.json()) as { text?: string };
          transcript = (data.text ?? "").trim();
        } catch (e) {
          console.error("[VoiceCopilot] Whisper fetch error:", e);
          return json({ ok: false, error: "Transcription request failed" }, 502);
        }

        if (!transcript) {
          return json({ ok: false, error: "Could not transcribe audio" }, 422);
        }

        // ── 3. Parse commands via GPT ─────────────────────────────────────────
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
              max_tokens: 1000,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: transcript },
              ],
            }),
          });
          if (!gptRes.ok) {
            const err = await gptRes.text();
            console.error("[VoiceCopilot] GPT error:", err);
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

        // ── 4. Filter to known actions & types ───────────────────────────────
        const VALID_ACTIONS = new Set(["CREATE_NODE", "CONNECT_NODES", "UPDATE_NODE", "UPDATE_SETTINGS"]);
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
