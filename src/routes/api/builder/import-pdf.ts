import { createFileRoute } from "@tanstack/react-router";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const SYSTEM_PROMPT = `You are a conversation flow architect. Convert a call centre / voice agent script into a structured multi-step conversation flow.

Output ONLY valid JSON — no markdown, no code fences, no extra text — with this shape:
{
  "title": "<2-4 word title>",
  "nodes": [
    {
      "id": "n1",
      "label": "<3-5 word step name>",
      "kind": "conversation",
      "dialogue": "<the agent instruction or script for this step>",
      "isStart": true
    }
  ]
}

Rules:
- First node MUST have "isStart": true
- Last node MUST have "kind": "ending" and a short closing line in "dialogue"
- All middle nodes use "kind": "conversation"
- Maximum 20 nodes total — merge closely related lines into one node
- Each "dialogue" is what the agent says or does at that step (keep it complete but concise)
- "label" is a short descriptive name (e.g. "Greeting", "Verify Identity", "Confirm Booking")
- Preserve the original speaker intent — do not rewrite the script`;

export const Route = createFileRoute("/api/builder/import-pdf")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),

      POST: async ({ request }) => {
        try {
          const apiKey = process.env["OPENAI_API_KEY"];
          if (!apiKey) return json({ error: "OpenAI API key not configured" }, 500);

          const formData = await request.formData();
          const file = formData.get("pdf");
          if (!file || !(file instanceof File)) {
            return json({ error: "No PDF file provided" }, 400);
          }
          if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
            return json({ error: "File must be a PDF" }, 400);
          }
          if (file.size > 10 * 1024 * 1024) {
            return json({ error: "PDF must be under 10 MB" }, 400);
          }

          // Extract text from PDF
          const buffer = Buffer.from(await file.arrayBuffer());
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (
            buf: Buffer,
          ) => Promise<{ text: string }>;
          const { text: rawText } = await pdfParse(buffer);

          const scriptText = rawText
            .replace(/\r\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim()
            .slice(0, 12000);

          if (!scriptText) {
            return json({ error: "Could not extract text from PDF" }, 422);
          }

          // Convert script to flow using OpenAI
          const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              temperature: 0.2,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: SYSTEM_PROMPT },
                {
                  role: "user",
                  content: `Convert this script into a conversation flow:\n\n${scriptText}`,
                },
              ],
            }),
          });

          if (!aiRes.ok) {
            const err = await aiRes.text();
            return json({ error: `OpenAI error: ${err.slice(0, 200)}` }, 502);
          }

          const aiJson = (await aiRes.json()) as {
            choices: Array<{ message: { content: string } }>;
          };
          const raw = JSON.parse(aiJson.choices[0].message.content) as {
            title: string;
            nodes: Array<{
              id: string;
              label: string;
              kind: string;
              dialogue: string;
              isStart?: boolean;
            }>;
          };

          if (!Array.isArray(raw.nodes) || raw.nodes.length === 0) {
            return json({ error: "AI returned no nodes" }, 422);
          }

          // Build FlowNodes + Edges
          const VALID_KINDS = new Set([
            "conversation","function","call_transfer","press_digit",
            "logic_split","agent_transfer","sms","extract_variable",
            "code","ending","note",
          ]);

          const nodes = raw.nodes.map((n, idx) => {
            const kind = VALID_KINDS.has(n.kind) ? n.kind : "conversation";
            const isLast = idx === raw.nodes.length - 1;
            const nodeId = `pdf-${n.id ?? `n${idx + 1}`}`;
            return {
              id: nodeId,
              type: kind,
              position: { x: idx * 320, y: 100 },
              data: {
                kind: isLast && kind !== "ending" ? "ending" : kind,
                label: String(n.label ?? `Step ${idx + 1}`),
                dialogue: String(n.dialogue ?? ""),
                isStart: idx === 0 ? true : undefined,
                transitions: [] as Array<{ id: string; condition: string; target: string | null }>,
              },
            };
          });

          // Wire sequential transitions + edges
          const edges: Array<{
            id: string;
            source: string;
            target: string;
            sourceHandle: string;
          }> = [];

          for (let i = 0; i < nodes.length - 1; i++) {
            const src = nodes[i];
            const dst = nodes[i + 1];
            if (src.data.kind === "ending") continue;
            const tId = `t-${src.id}-${dst.id}`;
            src.data.transitions.push({ id: tId, condition: "default", target: dst.id });
            edges.push({ id: tId, source: src.id, target: dst.id, sourceHandle: tId });
          }

          return json({
            title: String(raw.title ?? "Imported Script"),
            nodes,
            edges,
            nodeCount: nodes.length,
          });
        } catch (e) {
          console.error("[import-pdf]", e);
          return json({ error: (e as Error).message ?? "Processing failed" }, 500);
        }
      },
    },
  },
});
